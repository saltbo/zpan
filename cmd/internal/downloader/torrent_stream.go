package downloader

import (
	"bytes"
	"context"
	"crypto/sha1"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/pkg/torrentmeta"
)

// Streaming a torrent while it downloads (docs/design/torrents.md §14). While a
// task fills a torrent, the downloader asks the server which pieces players
// want, reads the pieces from there on from the engine's files as they
// complete, checks each against the info dictionary, and uploads runs of them
// as chunks. The server checks every piece again before it stores a chunk.

// torrentStreamAPI is the part of the server API streaming needs. A client
// without it streams nothing.
type torrentStreamAPI interface {
	TorrentStreamState(ctx context.Context, taskID string) (client.TorrentStreamState, error)
	PutTorrentStreamChunk(ctx context.Context, taskID string, firstPiece int, data []byte) error
}

var torrentStreamPollInterval = 2 * time.Second

type torrentStreamer struct {
	api     torrentStreamAPI
	taskID  string
	taskDir string
	info    torrentmeta.Info
	log     *slog.Logger
	// prepare has the engine download in order; it runs once, when a player
	// first wants a piece.
	prepare  func(context.Context) error
	prepared bool
	// intact are pieces read from disk whose hash matched; a piece stays intact
	// once it did.
	intact map[int]bool
	cancel context.CancelFunc
	done   chan struct{}
}

// streamTorrent starts streaming the task's torrent once its metadata is
// reported, unless it streams already or the server API cannot take chunks.
func (w *TaskRunner) streamTorrent(ctx context.Context, log *slog.Logger, task client.DownloadTask) {
	report := w.reportState(task.ID)
	if report == nil || report.info == nil || report.info.PieceCount() == 0 {
		return
	}
	api, ok := w.api.(torrentStreamAPI)
	if !ok {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.streams == nil {
		w.streams = map[string]*torrentStreamer{}
	}
	if _, running := w.streams[task.ID]; running {
		return
	}
	streamCtx, cancel := context.WithCancel(ctx)
	streamer := &torrentStreamer{
		api:     api,
		taskID:  task.ID,
		taskDir: filepath.Join(w.cfg.DownloadDir, task.ID),
		info:    *report.info,
		log:     log.With("stream", true),
		prepare: func(ctx context.Context) error {
			return w.downloader.PrepareTorrentStream(ctx, downloadTask(task))
		},
		intact: map[int]bool{},
		cancel: cancel,
		done:   make(chan struct{}),
	}
	w.streams[task.ID] = streamer
	go streamer.run(streamCtx)
}

// stopTorrentStream stops streaming the task's torrent and waits for an upload
// in flight to end.
func (w *TaskRunner) stopTorrentStream(taskID string) {
	w.mu.Lock()
	streamer := w.streams[taskID]
	delete(w.streams, taskID)
	w.mu.Unlock()
	if streamer != nil {
		streamer.cancel()
		<-streamer.done
	}
}

func (s *torrentStreamer) run(ctx context.Context) {
	defer close(s.done)
	ticker := time.NewTicker(torrentStreamPollInterval)
	defer ticker.Stop()
	for {
		err := s.tick(ctx)
		switch {
		case ctx.Err() != nil:
			return
		case client.IsConflict(err) || client.IsStatus(err, http.StatusNotFound):
			// The task no longer fills a downloading torrent: it became ready,
			// or another download took it over.
			s.log.Info("torrent no longer streams from this task", "error", err)
			return
		case err != nil:
			s.log.Warn("failed to stream torrent pieces", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// tick uploads, for each wanted piece, the intact pieces from there on that
// the server does not hold, up to the readahead, stopping at the first piece
// that is not on disk yet.
func (s *torrentStreamer) tick(ctx context.Context) error {
	state, err := s.api.TorrentStreamState(ctx, s.taskID)
	if err != nil {
		return err
	}
	if len(state.Wants) == 0 {
		return nil
	}
	if !s.prepared {
		if err := s.prepare(ctx); err != nil {
			s.log.Warn("the engine cannot download in order for streaming", "error", err)
		}
		s.prepared = true
	}
	stored := storedPieces(state.Chunks)
	readahead := max(1, int((state.ReadaheadBytes+state.PieceLength-1)/state.PieceLength))
	for _, want := range state.Wants {
		end := min(state.PieceCount, want+readahead)
		if err := s.uploadRuns(ctx, state, stored, want, end); err != nil {
			return err
		}
	}
	return nil
}

func storedPieces(chunks []client.TorrentStreamChunk) map[int]bool {
	stored := map[int]bool{}
	for _, chunk := range chunks {
		for piece := chunk.FirstPiece; piece < chunk.FirstPiece+chunk.PieceCount; piece++ {
			stored[piece] = true
		}
	}
	return stored
}

// uploadRuns uploads pieces [from, to) that the server does not hold, as runs
// of consecutive intact pieces of at most maxChunkBytes (or one piece).
func (s *torrentStreamer) uploadRuns(ctx context.Context, state client.TorrentStreamState, stored map[int]bool, from, to int) error {
	var run bytes.Buffer
	first := -1
	flush := func() error {
		if first < 0 {
			return nil
		}
		data := run.Bytes()
		count := 0
		for size := int64(0); size < int64(len(data)); count++ {
			size += s.info.PieceSize(first + count)
		}
		if err := s.api.PutTorrentStreamChunk(ctx, s.taskID, first, data); err != nil {
			return err
		}
		s.log.Debug("uploaded stream chunk", "first_piece", first, "pieces", count, "bytes", len(data))
		for piece := first; piece < first+count; piece++ {
			stored[piece] = true
		}
		run.Reset()
		first = -1
		return nil
	}
	for piece := from; piece < to; piece++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if stored[piece] {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		data, ok := s.readIntactPiece(piece)
		if !ok {
			// Sequential download fills from here on; the next tick goes on.
			break
		}
		if first >= 0 && int64(run.Len()+len(data)) > state.MaxChunkBytes {
			if err := flush(); err != nil {
				return err
			}
		}
		if first < 0 {
			first = piece
		}
		run.Write(data)
	}
	return flush()
}

// readIntactPiece reads the piece from the engine's files and returns it when
// its hash matches the dictionary.
func (s *torrentStreamer) readIntactPiece(piece int) ([]byte, bool) {
	data, err := readTorrentPiece(s.taskDir, s.info, piece)
	if err != nil {
		return nil, false
	}
	if !s.intact[piece] {
		sum := sha1.Sum(data)
		if !bytes.Equal(sum[:], s.info.PieceHash(piece)) {
			return nil, false
		}
		s.intact[piece] = true
	}
	return data, true
}

// readTorrentPiece reads the piece's bytes from the files of the torrent under
// the task folder; padding files read as zeros.
func readTorrentPiece(taskDir string, info torrentmeta.Info, piece int) ([]byte, error) {
	start := int64(piece) * info.PieceLength
	size := info.PieceSize(piece)
	if piece < 0 || size <= 0 {
		return nil, errors.New("piece out of range")
	}
	out := make([]byte, size)
	end := start + size
	for _, file := range info.Files {
		fileEnd := file.Offset + file.Size
		if fileEnd <= start || file.Offset >= end || file.Size == 0 {
			continue
		}
		from := max(start, file.Offset)
		to := min(end, fileEnd)
		if file.Padding {
			continue
		}
		f, err := openTorrentFile(taskDir, info, file)
		if err != nil {
			return nil, err
		}
		// A file shorter than its size is still being written: io.EOF.
		_, err = f.ReadAt(out[from-start:to-start], from-file.Offset)
		_ = f.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

// openTorrentFile opens a torrent file where the engine writes it: under a
// folder named after the torrent, or, for a single-file torrent, as the file
// itself, in the task folder. qBittorrent may keep an incomplete file with a
// `.!qB` suffix.
func openTorrentFile(taskDir string, info torrentmeta.Info, file torrentmeta.File) (*os.File, error) {
	rel := filepath.FromSlash(file.Path)
	candidates := []string{filepath.Join(taskDir, info.Name, rel), filepath.Join(taskDir, rel)}
	var err error
	for _, candidate := range candidates {
		for _, path := range []string{candidate, candidate + ".!qB"} {
			var f *os.File
			if f, err = os.Open(path); err == nil {
				return f, nil
			}
		}
	}
	return nil, err
}
