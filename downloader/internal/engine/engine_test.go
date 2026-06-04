package engine

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
