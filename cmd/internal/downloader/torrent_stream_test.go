package downloader

import (
	"bytes"
	"context"
	"crypto/sha1"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/pkg/torrentmeta"
)

// streamFixture is a two-file torrent with a padding file between them, laid
// out under taskDir/<name>/ the way the engines write it.
type streamFixture struct {
	taskDir string
	info    torrentmeta.Info
	data    []byte // the torrent's concatenated bytes, padding as zeros
}

func newStreamFixture(t *testing.T, pieceLength int64) streamFixture {
	t.Helper()
	first := bytes.Repeat([]byte("a"), 10)
	second := bytes.Repeat([]byte("b"), 9)
	padding := make([]byte, 2)
	data := append(append(append([]byte{}, first...), padding...), second...)
	info := torrentmeta.Info{
		Name:        "Show",
		PieceLength: pieceLength,
		Files: []torrentmeta.File{
			{Index: 0, Path: "E01.mkv", Size: int64(len(first)), Offset: 0},
			{Index: 1, Path: ".pad/2", Size: 2, Padding: true, Offset: 10},
			{Index: 2, Path: "E02.mkv", Size: int64(len(second)), Offset: 12},
		},
	}
	for start := int64(0); start < int64(len(data)); start += pieceLength {
		sum := sha1.Sum(data[start:min(int64(len(data)), start+pieceLength)])
		info.Pieces = append(info.Pieces, sum[:]...)
	}
	taskDir := t.TempDir()
	root := filepath.Join(taskDir, "Show")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "E01.mkv"), first, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "E02.mkv"), second, 0o644); err != nil {
		t.Fatal(err)
	}
	return streamFixture{taskDir: taskDir, info: info, data: data}
}

func TestReadTorrentPieceSpansFilesAndPadding(t *testing.T) {
	fx := newStreamFixture(t, 4)
	// Piece 2 is bytes 8..11: the end of E01.mkv and the padding file.
	got, err := readTorrentPiece(fx.taskDir, fx.info, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, fx.data[8:12]) {
		t.Fatalf("piece 2 = %q, want %q", got, fx.data[8:12])
	}
	// The last piece is short: byte 20.
	got, err = readTorrentPiece(fx.taskDir, fx.info, 5)
	if err != nil || !bytes.Equal(got, fx.data[20:]) {
		t.Fatalf("last piece = %q, %v", got, err)
	}
}

func TestReadTorrentPieceReadsIncompleteQBittorrentFile(t *testing.T) {
	fx := newStreamFixture(t, 4)
	path := filepath.Join(fx.taskDir, "Show", "E02.mkv")
	if err := os.Rename(path, path+".!qB"); err != nil {
		t.Fatal(err)
	}
	got, err := readTorrentPiece(fx.taskDir, fx.info, 4)
	if err != nil || !bytes.Equal(got, fx.data[16:20]) {
		t.Fatalf("piece 4 = %q, %v", got, err)
	}
}

func TestReadTorrentPieceFailsForAFileStillBeingWritten(t *testing.T) {
	fx := newStreamFixture(t, 4)
	if err := os.Truncate(filepath.Join(fx.taskDir, "Show", "E02.mkv"), 3); err != nil {
		t.Fatal(err)
	}
	if _, err := readTorrentPiece(fx.taskDir, fx.info, 4); err == nil {
		t.Fatal("read a piece past the end of an incomplete file")
	}
}

type fakeStreamAPI struct {
	state    client.TorrentStreamState
	uploaded []client.TorrentStreamChunk
	bodies   [][]byte
}

func (f *fakeStreamAPI) TorrentStreamState(context.Context, string) (client.TorrentStreamState, error) {
	return f.state, nil
}

func (f *fakeStreamAPI) PutTorrentStreamChunk(_ context.Context, _ string, firstPiece int, data []byte) error {
	f.bodies = append(f.bodies, append([]byte{}, data...))
	f.uploaded = append(f.uploaded, client.TorrentStreamChunk{FirstPiece: firstPiece})
	return nil
}

func newTestStreamer(fx streamFixture, api torrentStreamAPI, prepared *int) *torrentStreamer {
	return &torrentStreamer{
		api:     api,
		taskID:  "task-1",
		taskDir: fx.taskDir,
		info:    fx.info,
		log:     slog.New(slog.DiscardHandler),
		prepare: func(context.Context) error { *prepared++; return nil },
		intact:  map[int]bool{},
	}
}

// [spec: torrents/downloader-uploads-wanted-pieces]
func TestStreamerUploadsWantedPiecesInChunks(t *testing.T) {
	fx := newStreamFixture(t, 4)
	api := &fakeStreamAPI{state: client.TorrentStreamState{
		PieceLength:    4,
		PieceCount:     6,
		ReadaheadBytes: 16,
		MaxChunkBytes:  8,
		Wants:          []int{1},
		// Piece 2 is stored already.
		Chunks: []client.TorrentStreamChunk{{FirstPiece: 2, PieceCount: 1}},
	}}
	prepared := 0
	streamer := newTestStreamer(fx, api, &prepared)
	if err := streamer.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Pieces 1, then 3 and 4 (8 bytes, the chunk limit): 2 is stored, and the
	// readahead of four pieces ends before 5.
	want := []int{1, 3}
	if len(api.uploaded) != len(want) {
		t.Fatalf("uploaded %+v, want first pieces %v", api.uploaded, want)
	}
	for i, chunk := range api.uploaded {
		if chunk.FirstPiece != want[i] {
			t.Fatalf("uploaded %+v, want first pieces %v", api.uploaded, want)
		}
	}
	if !bytes.Equal(api.bodies[0], fx.data[4:8]) || !bytes.Equal(api.bodies[1], fx.data[12:20]) {
		t.Fatalf("bodies = %q", api.bodies)
	}
	if prepared != 1 {
		t.Fatalf("engine prepared %d times, want once", prepared)
	}
}

func TestStreamerStopsAtThePieceNotOnDiskYet(t *testing.T) {
	fx := newStreamFixture(t, 4)
	// E02.mkv holds zeros where the engine has not written yet.
	if err := os.WriteFile(filepath.Join(fx.taskDir, "Show", "E02.mkv"), make([]byte, 9), 0o644); err != nil {
		t.Fatal(err)
	}
	api := &fakeStreamAPI{state: client.TorrentStreamState{
		PieceLength: 4, PieceCount: 6, ReadaheadBytes: 64, MaxChunkBytes: 64, Wants: []int{0},
	}}
	prepared := 0
	if err := newTestStreamer(fx, api, &prepared).tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Pieces 0–2 hold E01.mkv and the padding; piece 3 starts E02.mkv.
	if len(api.bodies) != 1 || !bytes.Equal(api.bodies[0], fx.data[0:12]) {
		t.Fatalf("bodies = %q, want pieces 0-2", api.bodies)
	}
}

func TestStreamerIdlesWithoutWants(t *testing.T) {
	fx := newStreamFixture(t, 4)
	api := &fakeStreamAPI{state: client.TorrentStreamState{PieceLength: 4, PieceCount: 6, ReadaheadBytes: 64, MaxChunkBytes: 64}}
	prepared := 0
	if err := newTestStreamer(fx, api, &prepared).tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(api.uploaded) != 0 || prepared != 0 {
		t.Fatalf("uploaded %+v and prepared %d times without wants", api.uploaded, prepared)
	}
}
