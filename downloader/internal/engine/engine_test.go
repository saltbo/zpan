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

func TestResultFromPathZipsDirectory(t *testing.T) {
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

	result, err := resultFromPath(client.DownloadTask{ID: "task-1", Name: "bundle"}, taskDir, "bundle")
	if err != nil {
		t.Fatal(err)
	}
	if result.Name != "bundle.zip" {
		t.Fatalf("expected bundle.zip, got %s", result.Name)
	}
	if result.Size <= 0 {
		t.Fatalf("expected zip size > 0, got %d", result.Size)
	}
	if _, err := os.Stat(result.Path); err != nil {
		t.Fatal(err)
	}
}
