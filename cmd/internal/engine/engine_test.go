package engine

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Braurbeki/arigo"
	qbittorrent "github.com/autobrr/go-qbittorrent"
	"github.com/cenkalti/rpc2"
	"github.com/saltbo/zpan/cmd/internal/client"
)

func downloadTask(id, sourceType, sourceURI string) client.DownloadTask {
	return client.DownloadTask{
		ID: id,
		Spec: client.DownloadTaskSpec{
			Source:      client.DownloadTaskSource{Type: sourceType, URI: sourceURI},
			Destination: client.DownloadTaskDestination{},
			Labels:      client.DownloadTaskLabels{Tags: []string{}},
		},
		Status: client.DownloadTaskStatus{},
	}
}

func downloadTaskWithName(id, sourceType, sourceURI, name string) client.DownloadTask {
	task := downloadTask(id, sourceType, sourceURI)
	task.Spec.Destination.Name = name
	return task
}

func completedDownloadTask(id, sourceType, sourceURI string, size int64) client.DownloadTask {
	task := downloadTask(id, sourceType, sourceURI)
	task.Status.Progress.Download = client.DownloadTaskTransferProgress{Bytes: size, TotalBytes: &size}
	return task
}

func TestHTTPDownload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "11")
		_, _ = w.Write([]byte("hello world"))
	}))
	defer server.Close()

	dir := t.TempDir()
	progressCalls := 0
	var lastDetail *client.DownloadTaskRuntime
	result, err := (HTTP{Dir: dir}).Download(
		context.Background(),
		downloadTask("task-1", "http", server.URL+"/file.txt"),
		func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskRuntime) error {
			progressCalls++
			lastDetail = detail
			if downloaded < 0 {
				t.Fatalf("downloaded bytes must not be negative")
			}
			return nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Name != "file.txt" {
		t.Fatalf("expected file.txt, got %s", result.Name)
	}
	if result.Size != 11 {
		t.Fatalf("expected size 11, got %d", result.Size)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello world" {
		t.Fatalf("unexpected file content: %q", string(data))
	}
	if progressCalls == 0 {
		t.Fatal("expected progress callback")
	}
	if lastDetail == nil || lastDetail.Engine != "builtin" {
		t.Fatalf("expected builtin progress detail, got %#v", lastDetail)
	}
}

func TestHTTPRejectsMagnet(t *testing.T) {
	_, err := (HTTP{Dir: t.TempDir()}).Download(
		context.Background(),
		downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:abc"),
		func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskRuntime) error { return nil },
	)
	if err == nil {
		t.Fatal("expected magnet to be rejected by HTTP engine")
	}
}

func TestAria2StartArgsForceSaveCompletedSeeds(t *testing.T) {
	stateDir := t.TempDir()
	args, err := (Aria2{Dir: t.TempDir(), StateDir: stateDir}).startArgs("6800")
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, "\n")
	for _, expected := range []string{
		"--input-file=" + filepath.Join(stateDir, "aria2.session"),
		"--save-session=" + filepath.Join(stateDir, "aria2.session"),
		"--save-session-interval=30",
		"--force-save=true",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected aria2 args to contain %q, got %v", expected, args)
		}
	}
}

func TestHTTPDownloadResumesExistingFile(t *testing.T) {
	var rangeHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rangeHeader = r.Header.Get("Range")
		if rangeHeader != "bytes=5-" {
			t.Fatalf("expected resume range bytes=5-, got %q", rangeHeader)
		}
		w.Header().Set("Content-Length", "6")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte(" world"))
	}))
	defer server.Close()

	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(taskDir, "file.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := (HTTP{Dir: dir}).Download(
		context.Background(),
		downloadTask("task-1", "http", server.URL+"/file.txt"),
		func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskRuntime) error { return nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello world" {
		t.Fatalf("expected resumed content, got %q", string(data))
	}
	if result.Size != 11 {
		t.Fatalf("expected size 11, got %d", result.Size)
	}
}

func TestHTTPInspectTaskUsesCompletedCheckpoint(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "payload.bin"), []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	total := int64(7)

	snapshot, found, err := (HTTP{Dir: dir}).InspectTask(
		context.Background(),
		completedDownloadTask("task-1", "http", "https://example.com/payload.bin", total),
	)

	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected completed http checkpoint to be found")
	}
	if snapshot.State != TaskStateCompleted {
		t.Fatalf("expected completed state, got %#v", snapshot)
	}
	if snapshot.Result == nil || snapshot.Result.Path != filepath.Join(taskDir, "payload.bin") || snapshot.Result.Size != 7 {
		t.Fatalf("unexpected completed result: %#v", snapshot.Result)
	}
}

func TestHTTPInspectTaskDoesNotTrustLocalFileWithoutCompletedCheckpoint(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "payload.bin"), []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}

	snapshot, found, err := (HTTP{Dir: dir}).InspectTask(
		context.Background(),
		downloadTask("task-1", "http", "https://example.com/payload.bin"),
	)

	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatalf("expected local file without checkpoint not to be trusted, got %#v", snapshot)
	}
}

func TestHTTPInspectTaskRejectsSizeMismatch(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "payload.bin"), []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	total := int64(8)

	_, _, err := (HTTP{Dir: dir}).InspectTask(
		context.Background(),
		completedDownloadTask("task-1", "http", "https://example.com/payload.bin", total),
	)

	if err == nil || !strings.Contains(err.Error(), "size mismatch") {
		t.Fatalf("expected size mismatch error, got %v", err)
	}
}

func TestAria2StatusKeysRequestBittorrentPayload(t *testing.T) {
	keys := strings.Join(aria2StatusKeys, ",")
	if !strings.Contains(keys, "bittorrent") {
		t.Fatalf("expected aria2 status keys to request bittorrent payload, got %v", aria2StatusKeys)
	}
	if strings.Contains(keys, "bitTorrent") {
		t.Fatalf("aria2 status key is case-sensitive; use bittorrent, got %v", aria2StatusKeys)
	}
}

func TestQBittorrentCheckUsesWebAPIVersion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/app/version" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte("5.0.0"))
	}))
	defer server.Close()

	if err := (QBittorrent{URL: server.URL, Dir: t.TempDir()}).Check(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestQBittorrentHTTPDelegatesToBuiltin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "11")
		_, _ = w.Write([]byte("hello qbit!"))
	}))
	defer server.Close()

	result, err := (QBittorrent{URL: "http://127.0.0.1:1", Dir: t.TempDir()}).Download(
		context.Background(),
		downloadTask("task-1", "http", server.URL+"/file.txt"),
		func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskRuntime) error { return nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello qbit!" {
		t.Fatalf("unexpected file content: %q", string(data))
	}
}

func TestQBittorrentAddOptionsPassThroughTaskClassification(t *testing.T) {
	options := qbittorrentAddOptions(
		func() client.DownloadTask {
			task := downloadTaskWithName("task-1", "magnet", "magnet:?xt=urn:btih:abc", "fixture")
			task.Spec.Labels.Category = "movies"
			task.Spec.Labels.Tags = []string{"4k", "private"}
			return task
		}(),
		"/tmp/zpan/task-1",
		qbittorrentTrackingTag("task-1"),
	)

	if options["category"] != "movies" {
		t.Fatalf("expected task category, got %q", options["category"])
	}
	if options["tags"] != "ztid=task-1,4k,private" {
		t.Fatalf("expected tracking and task tags, got %q", options["tags"])
	}
	if options["rename"] != "fixture" {
		t.Fatalf("expected rename option, got %q", options["rename"])
	}
}

func TestQBittorrentAddOptionsDefaultsCategory(t *testing.T) {
	options := qbittorrentAddOptions(
		client.DownloadTask{ID: "task-1"},
		"/tmp/zpan/task-1",
		qbittorrentTrackingTag("task-1"),
	)

	if options["category"] != "zpan" {
		t.Fatalf("expected default category, got %q", options["category"])
	}
	if options["tags"] != "ztid=task-1" {
		t.Fatalf("expected tracking tag, got %q", options["tags"])
	}
}

func TestQBittorrentAddOptionsIgnoresTorrentTaskName(t *testing.T) {
	options := qbittorrentAddOptions(
		downloadTaskWithName("task-1", "magnet", "magnet:?xt=urn:btih:abc", "movie.torrent"),
		"/tmp/zpan/task-1",
		qbittorrentTrackingTag("task-1"),
	)

	if _, ok := options["rename"]; ok {
		t.Fatalf("expected torrent task name to be ignored, got rename=%q", options["rename"])
	}
}

func TestIsAria2RPCDisconnected(t *testing.T) {
	for _, err := range []error{
		rpc2.ErrShutdown,
		io.ErrClosedPipe,
		errors.New("connection is shut down"),
	} {
		if !isAria2RPCDisconnected(err) {
			t.Fatalf("expected %v to be treated as aria2 rpc disconnect", err)
		}
	}
	if isAria2RPCDisconnected(errors.New("aria2 download ended with status error")) {
		t.Fatal("expected ordinary aria2 error to stay non-transient")
	}
}

func TestAria2TaskInfoHash(t *testing.T) {
	const infoHash = "0546769f209ec059284b47f68659791a6f75ca8e"

	if got := aria2TaskInfoHash(downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:"+infoHash+"&dn=fixture")); got != infoHash {
		t.Fatalf("expected magnet infohash %s, got %s", infoHash, got)
	}
	taskWithRuntime := downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:abc")
	taskWithRuntime.Status.Runtime = &client.DownloadTaskRuntime{
		Torrent: &client.DownloadTaskTorrentRuntime{InfoHash: "0546769F209EC059284B47F68659791A6F75CA8E"},
	}
	if got := aria2TaskInfoHash(taskWithRuntime); got != infoHash {
		t.Fatalf("expected detail infohash %s, got %s", infoHash, got)
	}
	if got := aria2TaskInfoHash(downloadTask("task-1", "http", "https://example.com/file")); got != "" {
		t.Fatalf("expected no infohash for http task, got %s", got)
	}
}

func TestAria2StatusMatchesTaskByInfoHash(t *testing.T) {
	const infoHash = "0546769f209ec059284b47f68659791a6f75ca8e"

	if !aria2StatusMatchesTask(arigo.Status{InfoHash: strings.ToUpper(infoHash)}, "/tmp/zpan/task-1", "taskgid", infoHash) {
		t.Fatal("expected status to match by infohash")
	}
	if aria2StatusMatchesTask(arigo.Status{InfoHash: infoHash}, "/tmp/zpan/task-1", "taskgid", "") {
		t.Fatal("expected empty requested infohash not to match")
	}
}

func TestIsAria2DownloadCompleteTreatsActiveFullTorrentAsComplete(t *testing.T) {
	status := arigo.Status{
		Status:          arigo.StatusActive,
		TotalLength:     100,
		CompletedLength: 100,
		Files: []arigo.File{
			{Path: "/tmp/zpan/task-1/movie.mkv", Length: 100, CompletedLength: 100},
		},
	}

	if !isAria2DownloadComplete(status) {
		t.Fatal("expected active full torrent to be treated as completed")
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
		Files: []arigo.File{{
			Path:            "[METADATA]",
			Length:          17596,
			CompletedLength: 17596,
			Selected:        true,
		}},
	}
	payload := arigo.Status{
		GID:             "payload-gid",
		Status:          arigo.StatusActive,
		InfoHash:        infoHash,
		Dir:             taskDir,
		TotalLength:     100,
		CompletedLength: 100,
		Files: []arigo.File{{
			Path:            filepath.Join(taskDir, "album", "track.flac"),
			Length:          100,
			CompletedLength: 100,
			Selected:        true,
		}},
	}

	got, ok := selectAria2SeedStatus([]arigo.Status{metadata, payload}, SeedRef{InfoHash: infoHash}, taskDir)
	if !ok {
		t.Fatal("expected seed status")
	}
	if got.GID != "payload-gid" {
		t.Fatalf("expected payload seed, got %s", got.GID)
	}
}

func TestAria2TaskState(t *testing.T) {
	if got := aria2TaskState(arigo.Status{
		Status:          arigo.StatusActive,
		TotalLength:     100,
		CompletedLength: 100,
		Files:           []arigo.File{{Path: "/tmp/zpan/task-1/file.bin", Length: 100, CompletedLength: 100}},
	}); got != TaskStateCompleted {
		t.Fatalf("expected active full torrent to be completed, got %s", got)
	}
	if got := aria2TaskState(arigo.Status{Status: arigo.StatusActive, TotalLength: 100, CompletedLength: 10}); got != TaskStateDownloading {
		t.Fatalf("expected active partial torrent to be downloading, got %s", got)
	}
	if got := aria2TaskState(arigo.Status{Status: arigo.StatusError}); got != TaskStateFailed {
		t.Fatalf("expected error torrent to be failed, got %s", got)
	}
}

func TestQBittorrentTaskState(t *testing.T) {
	if got := qbittorrentTaskState(qbittorrent.Torrent{
		State:      qbittorrent.TorrentState("stalledUP"),
		Progress:   1,
		AmountLeft: 0,
		TotalSize:  100,
	}); got != TaskStateCompleted {
		t.Fatalf("expected seeding torrent to be completed, got %s", got)
	}
	if got := qbittorrentTaskState(qbittorrent.Torrent{
		State:      qbittorrent.TorrentState("downloading"),
		Progress:   0.5,
		AmountLeft: 50,
		TotalSize:  100,
	}); got != TaskStateDownloading {
		t.Fatalf("expected partial torrent to be downloading, got %s", got)
	}
	if got := qbittorrentTaskState(qbittorrent.Torrent{
		State:      qbittorrent.TorrentState("missingFiles"),
		Progress:   0.5,
		AmountLeft: 50,
		TotalSize:  100,
	}); got != TaskStateFailed {
		t.Fatalf("expected missing files torrent to be failed, got %s", got)
	}
}

func TestIsAria2InfoHashAlreadyRegistered(t *testing.T) {
	err := errors.New("InfoHash 0546769f209ec059284b47f68659791a6f75ca8e is already registered.")
	if !isAria2InfoHashAlreadyRegistered(err) {
		t.Fatal("expected aria2 infohash conflict to be attachable")
	}
	if isAria2InfoHashAlreadyRegistered(errors.New("aria2 download ended with status error")) {
		t.Fatal("expected ordinary aria2 error not to be treated as an infohash conflict")
	}
}

func TestAria2FilesReportsRelativeTorrentPaths(t *testing.T) {
	taskDir := filepath.Join(t.TempDir(), "task-1")
	files := aria2Files(taskDir, "album", []arigo.File{
		{
			Path:            filepath.Join(taskDir, "album", "disc-1", "track.flac"),
			Length:          100,
			CompletedLength: 50,
			Selected:        true,
		},
		{
			Path:            filepath.Join(t.TempDir(), "outside.flac"),
			Length:          10,
			CompletedLength: 10,
			Selected:        true,
		},
		{
			Path:   "[METADATA]info",
			Length: 1,
		},
	})

	if len(files) != 2 {
		t.Fatalf("expected two visible files, got %#v", files)
	}
	if files[0].Path != "disc-1/track.flac" {
		t.Fatalf("expected torrent root to be stripped, got %s", files[0].Path)
	}
	if files[1].Path != "outside.flac" {
		t.Fatalf("expected outside path to fall back to basename, got %s", files[1].Path)
	}
}

func TestStripTorrentRoot(t *testing.T) {
	cases := []struct {
		name        string
		path        string
		torrentName string
		want        string
	}{
		{name: "nested torrent root", path: "Album/Disc 1/track.flac", torrentName: "Album", want: "Disc 1/track.flac"},
		{name: "single file named like torrent", path: "Album", torrentName: "Album", want: "Album"},
		{name: "different root", path: "Other/track.flac", torrentName: "Album", want: "Other/track.flac"},
		{name: "empty torrent name", path: "Album/track.flac", torrentName: "", want: "Album/track.flac"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := stripTorrentRoot(tc.path, tc.torrentName); got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
}

func TestAria2DetailIncludesPeers(t *testing.T) {
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
	)

	if detail.Torrent == nil || detail.Torrent.Peers == nil || *detail.Torrent.Peers != 2 {
		t.Fatalf("expected peer count 2, got %#v", detail.Torrent)
	}
	if detail.Torrent.Leechers == nil || *detail.Torrent.Leechers != 1 {
		t.Fatalf("expected leecher count 1, got %#v", detail.Torrent.Leechers)
	}
	if len(detail.Peers) != 2 {
		t.Fatalf("expected peer samples, got %#v", detail.Peers)
	}
	if detail.Peers[0].Address != "192.0.2.10:6881" {
		t.Fatalf("unexpected peer address: %s", detail.Peers[0].Address)
	}
	if len(detail.Trackers) != 1 || detail.Trackers[0].Status != "announce" || detail.Trackers[0].Message == "" {
		t.Fatalf("expected aria2 tracker limitation marker, got %#v", detail.Trackers)
	}
	if detail.ETASeconds == nil || *detail.ETASeconds != 4 {
		t.Fatalf("expected ETA seconds 4, got %#v", detail.ETASeconds)
	}
}

func TestAria2DetailOmitsETAWithoutUsableSpeed(t *testing.T) {
	detail := aria2Detail(
		arigo.Status{
			TotalLength:     1000,
			CompletedLength: 250,
			DownloadSpeed:   0,
		},
		nil,
	)

	if detail.ETASeconds != nil {
		t.Fatalf("expected empty ETA without download speed, got %#v", detail.ETASeconds)
	}
}

func TestResultFromPathReturnsDirectory(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(filepath.Join(taskDir, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "folder", "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "folder", "b.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "fixture.torrent"), []byte("torrent"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "folder.aria2"), []byte("control"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := resultFromPath(downloadTaskWithName("task-1", "http", "https://example.com/bundle", "bundle"), taskDir, "bundle")
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsDir {
		t.Fatal("expected directory result")
	}
	if result.Name != "bundle" {
		t.Fatalf("expected bundle, got %s", result.Name)
	}
	if result.Size != 2 {
		t.Fatalf("expected directory size 2, got %d", result.Size)
	}
	if result.Path != filepath.Join(taskDir, "folder") {
		t.Fatalf("expected content dir path, got %s", result.Path)
	}
	if _, err := os.Stat(filepath.Join(result.Path, "a.txt")); err != nil {
		t.Fatal(err)
	}
}

func TestResultFromAria2FilesUsesSingleTopLevelDirectory(t *testing.T) {
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
	if err := os.WriteFile(filepath.Join(taskDir, "payload.aria2"), []byte("control"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := resultFromAria2Files(
		client.DownloadTask{ID: "task-1"},
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
	if result.Path != filepath.Join(taskDir, "payload") {
		t.Fatalf("expected payload dir path, got %s", result.Path)
	}
	if result.Name != "payload" {
		t.Fatalf("expected payload dir name, got %s", result.Name)
	}
	if result.Size != 2 {
		t.Fatalf("expected payload size 2, got %d", result.Size)
	}
}

func TestResultFromAria2FilesWrapsSingleFileBTTask(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "movie.mkv"), []byte("movie"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "movie.mkv.aria2"), []byte("control"), 0o644); err != nil {
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
	if !result.IsDir {
		t.Fatal("expected directory result")
	}
	if result.Path != taskDir {
		t.Fatalf("expected task dir path, got %s", result.Path)
	}
	if result.Name != "Iron.Lung.2026.1080p.WEBRip.10Bit.DDP.5.1.x265-NeoNoir" {
		t.Fatalf("expected torrent name wrapper dir, got %s", result.Name)
	}
	if result.Size != 5 {
		t.Fatalf("expected payload-only size 5, got %d", result.Size)
	}
}

func TestResultFromDownloadedFilesWrapsMultipleTopLevelEntries(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(filepath.Join(taskDir, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "folder", "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "root.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := resultFromDownloadedFiles(downloadTaskWithName("task-1", "http", "https://example.com/bundle", "bundle"), taskDir, "fallback", []downloadedFile{
		{path: filepath.Join(taskDir, "folder", "a.txt"), relativePath: filepath.Join("folder", "a.txt")},
		{path: filepath.Join(taskDir, "root.txt"), relativePath: "root.txt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != taskDir {
		t.Fatalf("expected task dir wrapper path, got %s", result.Path)
	}
	if result.Name != "bundle" {
		t.Fatalf("expected bundle wrapper name, got %s", result.Name)
	}
}

func TestOutputNameIgnoresTorrentTaskNameForBT(t *testing.T) {
	name := outputName(
		downloadTaskWithName("task-1", "magnet", "magnet:?xt=urn:btih:abc", "movie.torrent"),
		"movie.mkv",
	)

	if name != "movie.mkv" {
		t.Fatalf("expected payload fallback name, got %s", name)
	}
}

func TestOutputNameAllowsHTTPDownloadName(t *testing.T) {
	name := outputName(
		downloadTaskWithName("task-1", "http", "https://example.com/movie.torrent", "movie.torrent"),
		"download",
	)

	if name != "movie.torrent" {
		t.Fatalf("expected HTTP task name to be preserved, got %s", name)
	}
}
