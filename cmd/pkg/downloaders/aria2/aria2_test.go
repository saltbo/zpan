package aria2

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Braurbeki/arigo"
	"github.com/cenkalti/rpc2"
	"github.com/saltbo/zpan/internal/downloader"
)

func downloadTask(id, sourceType, sourceURI string) downloader.DownloadTask {
	return downloader.DownloadTask{ID: id, Source: downloader.Source{Type: sourceType, URI: sourceURI}, Labels: downloader.Labels{Tags: []string{}}}
}

func downloadTaskWithName(id, sourceType, sourceURI, name string) downloader.DownloadTask {
	task := downloadTask(id, sourceType, sourceURI)
	task.Destination.Name = name
	return task
}

func TestAria2DelegatesHTTPToBuiltin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "11")
		_, _ = w.Write([]byte("hello world"))
	}))
	defer server.Close()

	result, err := (Aria2{URL: "ws://127.0.0.1:1/jsonrpc", Dir: t.TempDir()}).Download(
		context.Background(),
		downloadTask("task-1", "http", server.URL+"/file.txt"),
		func(update downloader.ProgressUpdate) error {
			if update.Runtime != nil && update.Runtime.Engine != "http" {
				t.Fatalf("expected http HTTP runtime detail, got %#v", update.Runtime)
			}
			return nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello world" {
		t.Fatalf("unexpected file content: %q", string(data))
	}
}

func TestAria2StartArgs(t *testing.T) {
	stateDir := t.TempDir()
	args, err := (Aria2{
		Dir:                    t.TempDir(),
		StateDir:               stateDir,
		ListenPort:             51413,
		MaxConcurrentDownloads: 25,
		BtTrackers:             "udp://custom.example:1337/announce",
	}).startArgs("6800")
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, "\n")
	for _, expected := range []string{
		"--save-session=" + filepath.Join(stateDir, "aria2.session"),
		"--save-session-interval=30",
		"--force-save=true",
		"--listen-port=51413",
		"--enable-dht=true",
		"--enable-peer-exchange=true",
		"--bt-tracker=udp://custom.example:1337/announce",
		"--max-concurrent-downloads=25",
		"--dht-file-path=" + filepath.Join(stateDir, "dht.dat"),
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected aria2 args to contain %q, got %v", expected, args)
		}
	}
	if strings.Contains(joined, "--input-file=") {
		t.Fatalf("aria2 must not auto-restore old session tasks, got %v", args)
	}
}

func TestAria2ConstructorAndMetadata(t *testing.T) {
	cfg := downloader.Config{
		Engine:                 "aria2",
		DownloadDir:            t.TempDir(),
		StateDir:               t.TempDir(),
		BTListenPort:           51413,
		MaxConcurrentDownloads: 12,
		SeedEnabled:            true,
		SeedDuration:           time.Hour,
		SeedRatio:              1.5,
		Aria2: downloader.Aria2Config{
			URL:        "ws://127.0.0.1:6800/jsonrpc",
			Secret:     "secret",
			BtTrackers: "udp://tracker.example:1337/announce",
		},
	}
	d, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	a := d.(*Aria2)
	if a.Name() != "aria2" {
		t.Fatalf("unexpected name %q", a.Name())
	}
	if got := a.Capabilities().SourceTypes; len(got) != 3 || got[0] != "magnet" {
		t.Fatalf("unexpected capabilities %#v", got)
	}
	if !a.Managed || !a.RetainSeed || a.Secret != "secret" || a.MaxConcurrentDownloads != 12 || a.SeedRatio != 1.5 {
		t.Fatalf("unexpected constructed downloader: %#v", a)
	}
	a.Managed = false
	if err := a.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := a.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !configured(downloader.Config{Aria2: downloader.Aria2Config{Configured: true}}) {
		t.Fatal("expected configured aria2 config")
	}
}

func TestAria2StartErrors(t *testing.T) {
	engine := &Aria2{Managed: true, URL: "ws://example.com:6800/jsonrpc"}
	if err := engine.Start(context.Background()); err == nil {
		_ = engine.Stop(context.Background())
		t.Fatal("expected remote managed URL error")
	}
	if _, err := (Aria2{StateDir: string([]byte{0})}).startArgs("6800"); err == nil {
		t.Fatal("expected invalid state dir error")
	}
}

func TestAria2SeedTimeMinutes(t *testing.T) {
	if got := aria2SeedTimeMinutes(time.Hour); got != 60 {
		t.Fatalf("expected 1h to map to 60 minutes, got %d", got)
	}
	if got := aria2SeedTimeMinutes(0); got != aria2SeedForeverMinutes {
		t.Fatalf("expected zero duration to seed indefinitely, got %d", got)
	}
	if got := aria2SeedTimeMinutes(30 * time.Second); got != 1 {
		t.Fatalf("expected sub-minute duration to round up to 1, got %d", got)
	}
}

func TestShouldAttachExistingAria2Task(t *testing.T) {
	for _, state := range []string{"downloading", "uploading", "interrupted"} {
		if !shouldAttachExistingAria2Task(downloader.DownloadTask{Status: downloader.Status{State: state}}) {
			t.Fatalf("expected to attach for state %q", state)
		}
	}
	for _, state := range []string{"queued", "assigned", "paused", "completed", "canceling"} {
		if shouldAttachExistingAria2Task(downloader.DownloadTask{Status: downloader.Status{State: state}}) {
			t.Fatalf("did not expect to attach for state %q", state)
		}
	}
}

func TestAria2StatusKeysCoverReportedFields(t *testing.T) {
	required := []string{
		"bittorrent", "status", "totalLength", "completedLength",
		"downloadSpeed", "uploadLength", "uploadSpeed", "connections", "numSeeders",
	}
	have := map[string]bool{}
	for _, key := range aria2StatusKeys {
		have[key] = true
	}
	for _, key := range required {
		if !have[key] {
			t.Fatalf("aria2StatusKeys missing %q", key)
		}
	}
	if have["bitTorrent"] {
		t.Fatal("aria2 status key is case-sensitive; use bittorrent")
	}
}

func TestAria2ResetOperations(t *testing.T) {
	tests := []struct {
		name             string
		status           arigo.DownloadStatus
		wantRemoveActive bool
		wantRemoveResult bool
	}{
		{name: "active", status: arigo.StatusActive, wantRemoveActive: true, wantRemoveResult: true},
		{name: "waiting", status: arigo.StatusWaiting, wantRemoveActive: true, wantRemoveResult: true},
		{name: "paused", status: arigo.StatusPaused, wantRemoveActive: true, wantRemoveResult: true},
		{name: "completed", status: arigo.StatusCompleted, wantRemoveActive: false, wantRemoveResult: true},
		{name: "error", status: arigo.StatusError, wantRemoveActive: false, wantRemoveResult: true},
		{name: "removed", status: arigo.StatusRemoved, wantRemoveActive: false, wantRemoveResult: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			removeActive, removeResult := aria2ResetOperations(arigo.Status{Status: tt.status})
			if removeActive != tt.wantRemoveActive || removeResult != tt.wantRemoveResult {
				t.Fatalf("expected removeActive=%v removeResult=%v, got %v %v", tt.wantRemoveActive, tt.wantRemoveResult, removeActive, removeResult)
			}
		})
	}
}

func TestAria2ErrorClassification(t *testing.T) {
	if !isAria2DownloadNotFound(errors.New("Active Download not found for GID#b384ccaa7eae88da")) {
		t.Fatal("expected aria2 active download not found")
	}
	if !isAria2GIDNotFound(errors.New("GID 8bddd19e07ad6dc3 is not found")) {
		t.Fatal("expected tellStatus GID-not-found")
	}
	for _, err := range []error{rpc2.ErrShutdown, io.ErrClosedPipe, errors.New("connection is shut down")} {
		if !isAria2RPCDisconnected(err) {
			t.Fatalf("expected %v to be treated as aria2 rpc disconnect", err)
		}
	}
	if isAria2RPCDisconnected(nil) {
		t.Fatal("nil error must not be treated as disconnected")
	}
	if !isAria2InfoHashAlreadyRegistered(errors.New("InfoHash 0546769f209ec059284b47f68659791a6f75ca8e is already registered.")) {
		t.Fatal("expected aria2 infohash conflict to be attachable")
	}
}

func TestAria2TaskInfoHash(t *testing.T) {
	const infoHash = "0546769f209ec059284b47f68659791a6f75ca8e"
	if got := aria2TaskInfoHash(downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:"+infoHash+"&dn=fixture")); got != infoHash {
		t.Fatalf("expected magnet infohash %s, got %s", infoHash, got)
	}
	if got := aria2TaskInfoHash(downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:ARLHNHRAT3AFSKELI7TIMGMRDJXXLSP2")); len(got) != 40 {
		t.Fatalf("expected decoded base32 infohash, got %s", got)
	}
	taskWithRuntime := downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:abc")
	taskWithRuntime.Status.Runtime = &downloader.TaskRuntime{Torrent: &downloader.TorrentRuntime{InfoHash: strings.ToUpper(infoHash)}}
	if got := aria2TaskInfoHash(taskWithRuntime); got != infoHash {
		t.Fatalf("expected detail infohash %s, got %s", infoHash, got)
	}
	for _, task := range []downloader.DownloadTask{
		downloadTask("task-1", "http", "https://example.com/file.bin"),
		downloadTask("task-1", "magnet", "%zz"),
		downloadTask("task-1", "magnet", "magnet:?xt=urn:notbtih:abc"),
		downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:not-hex"),
	} {
		if got := aria2TaskInfoHash(task); got != "" {
			t.Fatalf("expected empty infohash for %#v, got %q", task, got)
		}
	}
	if got := aria2TaskGID("task-1"); got != "7afaa346b4bf92bf" {
		t.Fatalf("unexpected deterministic gid: %s", got)
	}
}

func TestAria2TaskState(t *testing.T) {
	if got := aria2TaskState(arigo.Status{
		Status:          arigo.StatusActive,
		TotalLength:     100,
		CompletedLength: 100,
		Files:           []arigo.File{{Path: "/tmp/zpan/task-1/file.bin", Length: 100, CompletedLength: 100}},
	}); got != downloader.TaskStateCompleted {
		t.Fatalf("expected active full torrent to be completed, got %s", got)
	}
	if got := aria2TaskState(arigo.Status{Status: arigo.StatusActive, TotalLength: 100, CompletedLength: 10}); got != downloader.TaskStateDownloading {
		t.Fatalf("expected active partial torrent to be downloading, got %s", got)
	}
	if got := aria2TaskState(arigo.Status{Status: arigo.StatusError}); got != downloader.TaskStateFailed {
		t.Fatalf("expected error torrent to be failed, got %s", got)
	}
}

func TestAria2SeedAndStatusHelpers(t *testing.T) {
	taskDir := filepath.Join(t.TempDir(), "task-1")
	statuses := []arigo.Status{
		{GID: "not-seed", TotalLength: 100, CompletedLength: 50, Dir: taskDir, Files: []arigo.File{{Path: filepath.Join(taskDir, "partial.bin")}}},
		{GID: "seed-by-hash", InfoHash: "ABCDEF", TotalLength: 100, CompletedLength: 100, Dir: taskDir, Files: []arigo.File{{Path: filepath.Join(taskDir, "done.bin")}}},
		{GID: "seed-by-dir", TotalLength: 100, CompletedLength: 100, Dir: taskDir, Files: []arigo.File{{Path: filepath.Join(taskDir, "done.bin")}}},
	}
	if got, ok := selectAria2SeedStatus(statuses, downloader.SeedRef{InfoHash: "abcdef"}, ""); !ok || got.GID != "seed-by-hash" {
		t.Fatalf("expected seed by hash, got %#v ok=%v", got, ok)
	}
	if got, ok := selectAria2SeedStatus(statuses, downloader.SeedRef{}, taskDir); !ok || got.GID != "seed-by-hash" {
		t.Fatalf("expected seed by task dir, got %#v ok=%v", got, ok)
	}
	if _, ok := selectAria2SeedStatus(statuses, downloader.SeedRef{InfoHash: "missing"}, filepath.Join(taskDir, "missing")); ok {
		t.Fatal("did not expect missing seed match")
	}
	if got := aria2SeedTaskDir("/downloads", downloader.SeedRef{TaskID: "task-2"}); got != filepath.Clean("/downloads/task-2") {
		t.Fatalf("unexpected fallback seed dir: %s", got)
	}
	if got := aria2SeedTaskDir("/downloads", downloader.SeedRef{TaskID: "task-2", Path: taskDir}); got != filepath.Clean(taskDir) {
		t.Fatalf("unexpected explicit seed dir: %s", got)
	}
	if got := aria2StatusTaskDir(arigo.Status{}, taskDir); got != taskDir {
		t.Fatalf("unexpected fallback status dir: %s", got)
	}
	if got := aria2StatusTaskDir(arigo.Status{Dir: taskDir}, "fallback"); got != filepath.Clean(taskDir) {
		t.Fatalf("unexpected status dir: %s", got)
	}
	seed := (Aria2{}).seedFromStatus(arigo.Status{GID: "gid-1", InfoHash: "ABCDEF"}, taskDir)
	if seed.Engine != "aria2" || seed.ID != "gid-1" || seed.InfoHash != "abcdef" || seed.Path != taskDir || seed.Snapshot == nil || seed.Cleanup == nil {
		t.Fatalf("unexpected seed: %#v", seed)
	}
}

func TestAria2StatusMatchingHelpers(t *testing.T) {
	taskDir := filepath.Join(t.TempDir(), "task-1")
	if !aria2StatusMatchesTask(arigo.Status{GID: "gid-1"}, taskDir, "gid-1", "") {
		t.Fatal("expected gid match")
	}
	if !aria2StatusMatchesTask(arigo.Status{Following: "gid-1"}, taskDir, "gid-1", "") {
		t.Fatal("expected following match")
	}
	if !aria2StatusMatchesTask(arigo.Status{BelongsTo: "gid-1"}, taskDir, "gid-1", "") {
		t.Fatal("expected belongsTo match")
	}
	if !aria2StatusMatchesTask(arigo.Status{InfoHash: "ABCDEF"}, taskDir, "gid-1", "abcdef") {
		t.Fatal("expected infohash match")
	}
	if !aria2StatusMatchesTask(arigo.Status{Dir: taskDir}, taskDir, "gid-1", "") {
		t.Fatal("expected directory match")
	}
	if !aria2StatusMatchesTask(arigo.Status{Files: []arigo.File{{Path: filepath.Join(taskDir, "file.bin")}}}, taskDir, "gid-1", "") {
		t.Fatal("expected file path match")
	}
	if aria2StatusMatchesTask(arigo.Status{Files: []arigo.File{{Path: filepath.Join(filepath.Dir(taskDir), "other", "file.bin")}}}, taskDir, "gid-1", "") {
		t.Fatal("did not expect unrelated file path match")
	}
	if !aria2StatusBelongsToTask(arigo.Status{Dir: taskDir}, taskDir, "gid-1") {
		t.Fatal("expected belongs-to directory match")
	}
	if aria2StatusBelongsToTask(arigo.Status{Dir: filepath.Dir(taskDir)}, taskDir, "gid-1") {
		t.Fatal("did not expect parent directory match")
	}
}

func TestAria2RuntimeConversionHelpers(t *testing.T) {
	if got := aria2Phase(arigo.Status{Status: arigo.StatusWaiting, FollowedBy: []string{"child"}}); got != "metadata" {
		t.Fatalf("expected metadata phase, got %s", got)
	}
	if got := aria2Phase(arigo.Status{Status: arigo.StatusActive, Files: []arigo.File{{Path: "[METADATA]fixture"}}}); got != "metadata" {
		t.Fatalf("expected active metadata phase, got %s", got)
	}
	if got := aria2Phase(arigo.Status{Status: arigo.StatusWaiting}); got != "downloading" {
		t.Fatalf("expected waiting download phase, got %s", got)
	}
	if got := aria2Phase(arigo.Status{Status: arigo.StatusCompleted}); got != "completed" {
		t.Fatalf("expected completed phase, got %s", got)
	}
	if got := aria2Phase(arigo.Status{Status: arigo.StatusRemoved}); got != "error" {
		t.Fatalf("expected removed phase error, got %s", got)
	}
	if aria2PeerProgress(arigo.Peer{}) != nil {
		t.Fatal("expected nil progress without bitfield")
	}
	if aria2PeerProgress(arigo.Peer{BitField: "xyz"}) != nil {
		t.Fatal("expected nil progress for invalid bitfield")
	}
	if progress := aria2PeerProgress(arigo.Peer{Seeder: true}); progress == nil || *progress != 1 {
		t.Fatalf("expected seeder full progress, got %#v", progress)
	}
	if progress := aria2PeerProgress(arigo.Peer{BitField: "f0"}); progress == nil || *progress != 0.5 {
		t.Fatalf("expected half progress, got %#v", progress)
	}

	trackers := make([][]string, 1)
	for i := 0; i < 25; i++ {
		trackers[0] = append(trackers[0], fmt.Sprintf("udp://tracker-%02d/announce", i))
	}
	trackers[0] = append(trackers[0], "udp://tracker-00/announce", "")
	if got := aria2Trackers(trackers); len(got) != 20 || got[0].URL != "udp://tracker-00/announce" {
		t.Fatalf("unexpected trackers: %#v", got)
	}

	peers := aria2Peers([]arigo.Peer{
		{IP: "", Port: 6881},
		{IP: "203.0.113.10", Port: 6881, DownloadSpeed: 10, UploadSpeed: 2, BitField: "f"},
	}, nil)
	if len(peers) != 1 || peers[0].Address != "203.0.113.10:6881" || *peers[0].DownloadBps != 10 || *peers[0].UploadBps != 2 {
		t.Fatalf("unexpected peers: %#v", peers)
	}
}

func TestReportMetadataProgressKeepsRuntimeButHidesMetadataBytes(t *testing.T) {
	total := int64(14151)
	var got downloader.ProgressUpdate
	reporter := reportMetadataProgress(func(update downloader.ProgressUpdate) error {
		got = update
		return nil
	})

	err := reporter(downloader.ProgressUpdate{
		Downloaded: 1024,
		Total:      &total,
		Bps:        512,
		Runtime: &downloader.TaskRuntime{
			Engine:     "aria2",
			Phase:      "downloading",
			ETASeconds: &total,
			Trackers:   []downloader.Tracker{{URL: "udp://tracker.example:1337/announce"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Downloaded != 0 || got.Total != nil || got.Bps != 0 {
		t.Fatalf("metadata progress must not expose metadata bytes, got %#v", got)
	}
	if got.Runtime == nil || got.Runtime.Phase != "metadata" || got.Runtime.ETASeconds != nil || len(got.Runtime.Trackers) != 1 {
		t.Fatalf("expected metadata runtime with trackers, got %#v", got.Runtime)
	}
}

func TestAria2FilesDetailAndResultHelpers(t *testing.T) {
	taskDir := t.TempDir()
	contentPath := filepath.Join(taskDir, "Torrent", "movie.mkv")
	if err := os.MkdirAll(filepath.Dir(contentPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(contentPath, []byte("movie"), 0o600); err != nil {
		t.Fatal(err)
	}
	files := []arigo.File{
		{Path: "[METADATA]fixture", Length: 1, CompletedLength: 1, Selected: true},
		{Path: contentPath, Length: 5, CompletedLength: 5, Selected: true},
	}
	converted := aria2Files(taskDir, "Torrent", files)
	if len(converted) != 1 || converted[0].Path != "movie.mkv" || converted[0].Size != 5 || *converted[0].CompletedBytes != 5 || !*converted[0].Selected {
		t.Fatalf("unexpected converted files: %#v", converted)
	}
	result, err := resultFromAria2Files(downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:abc"), taskDir, "Torrent", files)
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != filepath.Join(taskDir, "Torrent") || result.Name != "Torrent" || !result.IsDir {
		t.Fatalf("unexpected result: %#v", result)
	}
	status := arigo.Status{
		GID:             "gid-1",
		Status:          arigo.StatusActive,
		TotalLength:     10,
		CompletedLength: 5,
		DownloadSpeed:   5,
		UploadLength:    2,
		UploadSpeed:     1,
		Connections:     3,
		NumSeeders:      4,
		Dir:             taskDir,
		InfoHash:        "abcdef",
		Files:           files,
		BitTorrent: arigo.BitTorrentStatus{
			Info:         arigo.BitTorrentStatusInfo{Name: "Torrent"},
			AnnounceList: [][]string{{"udp://tracker/announce"}},
		},
	}
	detail := aria2Detail(status, []arigo.Peer{{IP: "203.0.113.10", Port: 6881, Seeder: false}}, nil)
	if detail.Engine != "aria2" || detail.Phase != "downloading" || detail.Torrent == nil || detail.Torrent.InfoHash != "abcdef" || detail.ETASeconds == nil || *detail.ETASeconds != 1 {
		t.Fatalf("unexpected detail: %#v", detail)
	}
}

func TestSelectAria2SeedStatusPrefersCompletedPayloadOverMetadata(t *testing.T) {
	infoHash := "f8f8044d5dfeef2719dcda6ce42dba1c4eb9ea22"
	taskDir := filepath.Join(t.TempDir(), "task-1")
	metadata := arigo.Status{
		GID:             "metadata-gid",
		Status:          arigo.StatusCompleted,
		InfoHash:        infoHash,
		Dir:             taskDir,
		TotalLength:     17596,
		CompletedLength: 17596,
		Files:           []arigo.File{{Path: "[METADATA]", Length: 17596, CompletedLength: 17596, Selected: true}},
	}
	payload := arigo.Status{
		GID:             "payload-gid",
		Status:          arigo.StatusActive,
		InfoHash:        infoHash,
		Dir:             taskDir,
		TotalLength:     100,
		CompletedLength: 100,
		Files:           []arigo.File{{Path: filepath.Join(taskDir, "album", "track.flac"), Length: 100, CompletedLength: 100, Selected: true}},
	}

	got, ok := selectAria2SeedStatus([]arigo.Status{metadata, payload}, downloader.SeedRef{InfoHash: infoHash}, taskDir)
	if !ok || got.GID != "payload-gid" {
		t.Fatalf("expected payload seed, ok=%v got=%s", ok, got.GID)
	}
}

func TestAria2FilesReportsRelativeTorrentPaths(t *testing.T) {
	taskDir := filepath.Join(t.TempDir(), "task-1")
	files := aria2Files(taskDir, "album", []arigo.File{
		{Path: filepath.Join(taskDir, "album", "disc-1", "track.flac"), Length: 100, CompletedLength: 50, Selected: true},
		{Path: filepath.Join(t.TempDir(), "outside.flac"), Length: 10, CompletedLength: 10, Selected: true},
		{Path: "[METADATA]info", Length: 1},
	})

	if len(files) != 2 {
		t.Fatalf("expected two visible files, got %#v", files)
	}
	if files[0].Path != "disc-1/track.flac" || files[1].Path != "outside.flac" {
		t.Fatalf("unexpected relative paths: %#v", files)
	}
}

func TestAria2DetailIncludesPeersAndOmitsEmptyETA(t *testing.T) {
	detail := aria2Detail(
		arigo.Status{
			TotalLength:     1000,
			CompletedLength: 250,
			DownloadSpeed:   200,
			Connections:     44,
			NumSeeders:      4,
			BitTorrent: arigo.BitTorrentStatus{
				AnnounceList: [][]string{{"udp://tracker.example:1337/announce"}},
				Info:         arigo.BitTorrentStatusInfo{Name: "fixture.torrent"},
			},
		},
		[]arigo.Peer{
			{IP: "192.0.2.10", Port: 6881, DownloadSpeed: 1024, UploadSpeed: 256, Seeder: true},
			{IP: "192.0.2.11", Port: 6882, DownloadSpeed: 2048, UploadSpeed: 512, Seeder: false},
		},
		nil,
	)

	if detail.Torrent == nil || detail.Torrent.Peers == nil || *detail.Torrent.Peers != 2 {
		t.Fatalf("expected peer count 2, got %#v", detail.Torrent)
	}
	if len(detail.Peers) != 2 || detail.Peers[0].Address != "192.0.2.10:6881" {
		t.Fatalf("expected peer samples, got %#v", detail.Peers)
	}
	if detail.ETASeconds == nil || *detail.ETASeconds != 4 {
		t.Fatalf("expected ETA seconds 4, got %#v", detail.ETASeconds)
	}

	noSpeed := aria2Detail(arigo.Status{TotalLength: 1000, CompletedLength: 250}, nil, nil)
	if noSpeed.ETASeconds != nil {
		t.Fatalf("expected empty ETA without download speed, got %#v", noSpeed.ETASeconds)
	}
}

func TestResultFromAria2Files(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(filepath.Join(taskDir, "payload"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "payload", "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "payload", "b.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := resultFromAria2Files(
		downloader.DownloadTask{ID: "task-1"},
		taskDir,
		"payload",
		[]arigo.File{
			{Path: filepath.Join(taskDir, "payload", "a.txt"), Length: 1, Selected: true},
			{Path: filepath.Join(taskDir, "payload", "b.txt"), Length: 1, Selected: true},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != filepath.Join(taskDir, "payload") || result.Name != "payload" || result.Size != 2 {
		t.Fatalf("unexpected aria2 result: %#v", result)
	}
}

func TestResultFromAria2FilesWrapsSingleFileBTTask(t *testing.T) {
	taskDir := filepath.Join(t.TempDir(), "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "movie.mkv"), []byte("movie"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := resultFromAria2Files(
		downloadTaskWithName("task-1", "magnet", "magnet:?xt=urn:btih:abc", "movie.torrent"),
		taskDir,
		"Iron.Lung.2026.1080p.WEBRip.10Bit.DDP.5.1.x265-NeoNoir",
		[]arigo.File{{Path: filepath.Join(taskDir, "movie.mkv"), Length: 5, Selected: true}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsDir || result.Path != taskDir || result.Size != 5 {
		t.Fatalf("unexpected single-file torrent result: %#v", result)
	}
	if result.Name != "Iron.Lung.2026.1080p.WEBRip.10Bit.DDP.5.1.x265-NeoNoir" {
		t.Fatalf("expected torrent name wrapper dir, got %s", result.Name)
	}
}
