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
	"github.com/cenkalti/rpc2"
	"github.com/saltbo/zpan/downloader/internal/client"
)

func TestHTTPDownload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "11")
		_, _ = w.Write([]byte("hello world"))
	}))
	defer server.Close()

	dir := t.TempDir()
	progressCalls := 0
	var lastDetail *client.DownloadTaskDetail
	result, err := (HTTP{Dir: dir}).Download(
		context.Background(),
		client.DownloadTask{ID: "task-1", SourceType: "http", SourceURI: server.URL + "/file.txt"},
		func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error {
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
		client.DownloadTask{ID: "task-1", SourceType: "magnet", SourceURI: "magnet:?xt=urn:btih:abc"},
		func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error { return nil },
	)
	if err == nil {
		t.Fatal("expected magnet to be rejected by HTTP engine")
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
		client.DownloadTask{ID: "task-1", SourceType: "http", SourceURI: server.URL + "/file.txt"},
		func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error { return nil },
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
		client.DownloadTask{ID: "task-1", SourceType: "http", SourceURI: server.URL + "/file.txt"},
		func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error { return nil },
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
		client.DownloadTask{
			ID:       "task-1",
			Name:     "fixture",
			Category: "movies",
			Tags:     []string{"4k", "private"},
		},
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
		client.DownloadTask{ID: "task-1", SourceType: "magnet", Name: "movie.torrent"},
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

	if got := aria2TaskInfoHash(client.DownloadTask{
		SourceType: "magnet",
		SourceURI:  "magnet:?xt=urn:btih:" + infoHash + "&dn=fixture",
	}); got != infoHash {
		t.Fatalf("expected magnet infohash %s, got %s", infoHash, got)
	}
	if got := aria2TaskInfoHash(client.DownloadTask{
		Detail: &client.DownloadTaskDetail{InfoHash: "0546769F209EC059284B47F68659791A6F75CA8E"},
	}); got != infoHash {
		t.Fatalf("expected detail infohash %s, got %s", infoHash, got)
	}
	if got := aria2TaskInfoHash(client.DownloadTask{SourceType: "http", SourceURI: "https://example.com/file"}); got != "" {
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

func TestIsAria2InfoHashAlreadyRegistered(t *testing.T) {
	err := errors.New("InfoHash 0546769f209ec059284b47f68659791a6f75ca8e is already registered.")
	if !isAria2InfoHashAlreadyRegistered(err) {
		t.Fatal("expected aria2 infohash conflict to be recoverable")
	}
	if isAria2InfoHashAlreadyRegistered(errors.New("aria2 download ended with status error")) {
		t.Fatal("expected ordinary aria2 error to stay non-recoverable")
	}
}

func TestAria2DetailIncludesPeerSamples(t *testing.T) {
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

	if detail.Peers == nil || *detail.Peers != 2 {
		t.Fatalf("expected peer count 2, got %#v", detail.Peers)
	}
	if detail.Leechers == nil || *detail.Leechers != 1 {
		t.Fatalf("expected leecher count 1, got %#v", detail.Leechers)
	}
	if len(detail.PeerSamples) != 2 {
		t.Fatalf("expected peer samples, got %#v", detail.PeerSamples)
	}
	if detail.PeerSamples[0].Address != "192.0.2.10:6881" {
		t.Fatalf("unexpected peer address: %s", detail.PeerSamples[0].Address)
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

	result, err := resultFromPath(client.DownloadTask{ID: "task-1", Name: "bundle"}, taskDir, "bundle")
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
		client.DownloadTask{ID: "task-1", SourceType: "magnet", Name: "movie.torrent"},
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

	result, err := resultFromDownloadedFiles(client.DownloadTask{ID: "task-1", Name: "bundle"}, taskDir, "fallback", []downloadedFile{
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
		client.DownloadTask{ID: "task-1", SourceType: "magnet", Name: "movie.torrent"},
		"movie.mkv",
	)

	if name != "movie.mkv" {
		t.Fatalf("expected payload fallback name, got %s", name)
	}
}

func TestOutputNameAllowsHTTPDownloadTorrentName(t *testing.T) {
	name := outputName(
		client.DownloadTask{ID: "task-1", SourceType: "http", Name: "movie.torrent"},
		"download",
	)

	if name != "movie.torrent" {
		t.Fatalf("expected HTTP task name to be preserved, got %s", name)
	}
}
