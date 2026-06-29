package httpdl

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/saltbo/zpan/internal/downloader"
)

func downloadTask(id, sourceType, sourceURI string) downloader.DownloadTask {
	return downloader.DownloadTask{ID: id, Source: downloader.Source{Type: sourceType, URI: sourceURI}}
}

func completedDownloadTask(id, sourceType, sourceURI string, size int64) downloader.DownloadTask {
	task := downloadTask(id, sourceType, sourceURI)
	task.Status.Progress.Download = downloader.TransferProgress{Bytes: size, TotalBytes: &size}
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
	var lastDetail *downloader.TaskRuntime
	result, err := (HTTP{Dir: dir}).Download(
		context.Background(),
		downloadTask("task-1", "http", server.URL+"/file.txt"),
		func(update downloader.ProgressUpdate) error {
			progressCalls++
			lastDetail = update.Runtime
			return nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Name != "file.txt" || result.Size != 11 {
		t.Fatalf("unexpected result: %#v", result)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello world" {
		t.Fatalf("unexpected file content: %q", string(data))
	}
	if progressCalls == 0 || lastDetail == nil || lastDetail.Engine != "http" {
		t.Fatalf("expected http progress callback, calls=%d detail=%#v", progressCalls, lastDetail)
	}
}

func TestHTTPRejectsMagnet(t *testing.T) {
	_, err := (HTTP{Dir: t.TempDir()}).Download(
		context.Background(),
		downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:abc"),
		func(update downloader.ProgressUpdate) error { return nil },
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
		downloadTask("task-1", "http", server.URL+"/file.txt"),
		func(update downloader.ProgressUpdate) error { return nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello world" || result.Size != 11 {
		t.Fatalf("expected resumed content size 11, got %q size=%d", string(data), result.Size)
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
	if !found || snapshot.State != downloader.TaskStateCompleted {
		t.Fatalf("expected completed checkpoint, found=%v snapshot=%#v", found, snapshot)
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

func TestHTTPRangeNotSatisfiableReusesExistingFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Range"); got != "bytes=7-" {
			t.Fatalf("expected range request, got %q", got)
		}
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
	}))
	defer server.Close()

	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "payload.bin"), []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := (HTTP{Dir: dir}).Download(
		context.Background(),
		downloadTask("task-1", "http", server.URL+"/payload.bin"),
		func(update downloader.ProgressUpdate) error { return nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Size != int64(len("payload")) {
		t.Fatalf("expected existing size %d, got %d", len("payload"), result.Size)
	}
}

func TestHTTPPropagatesProgressError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(1<<20))
		_, _ = w.Write(make([]byte, 1<<20))
	}))
	defer server.Close()

	want := errors.New("stop")
	_, err := (HTTP{Dir: t.TempDir()}).Download(
		context.Background(),
		downloadTask("task-1", "http", server.URL+"/payload.bin"),
		func(update downloader.ProgressUpdate) error {
			if update.Runtime != nil && update.Runtime.Phase == "completed" {
				return want
			}
			return nil
		},
	)
	if !errors.Is(err, want) {
		t.Fatalf("expected progress error, got %v", err)
	}
}

func TestHTTPMetadataAndHealth(t *testing.T) {
	engine := HTTP{Dir: t.TempDir()}
	if engine.Name() != "http" {
		t.Fatalf("unexpected name %q", engine.Name())
	}
	if got := engine.Capabilities().SourceTypes; len(got) != 1 || got[0] != "http" {
		t.Fatalf("unexpected capabilities %#v", got)
	}
	if err := engine.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := engine.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := engine.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestHTTPResetAndInspectIgnoreNonHTTP(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := (HTTP{Dir: dir}).ResetTask(context.Background(), downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:abc")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(taskDir); err != nil {
		t.Fatal(err)
	}
	if err := (HTTP{Dir: dir}).ResetTask(context.Background(), downloadTask("task-1", "http", "https://example.com/file.bin")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(taskDir); !os.IsNotExist(err) {
		t.Fatalf("expected task dir removal, got %v", err)
	}
	if _, found, err := (HTTP{Dir: dir}).InspectTask(context.Background(), downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:abc")); err != nil || found {
		t.Fatalf("expected non-http inspect ignored, found=%v err=%v", found, err)
	}
}

func TestHTTPDownloadErrorBranches(t *testing.T) {
	if _, err := (HTTP{Dir: t.TempDir()}).Download(context.Background(), downloadTask("task-1", "http", "ftp://example.com/file.bin"), func(downloader.ProgressUpdate) error { return nil }); err == nil {
		t.Fatal("expected unsupported URL error")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	if _, err := (HTTP{Dir: t.TempDir()}).Download(context.Background(), downloadTask("task-1", "http", server.URL+"/file.bin"), func(downloader.ProgressUpdate) error { return nil }); err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("expected HTTP status error, got %v", err)
	}
}

func TestHTTPDownloadRestartsWhenServerIgnoresRange(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") == "" {
			t.Fatal("expected range header")
		}
		w.Header().Set("Content-Length", "5")
		_, _ = w.Write([]byte("fresh"))
	}))
	defer server.Close()
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(taskDir, "file.bin")
	if err := os.WriteFile(path, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := (HTTP{Dir: dir}).Download(context.Background(), downloadTask("task-1", "http", server.URL+"/file.bin"), func(downloader.ProgressUpdate) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "fresh" || result.Size != 5 {
		t.Fatalf("expected restarted content, got %q size=%d", string(data), result.Size)
	}
}

func TestHTTPInspectTaskRejectsDirectoryResult(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(filepath.Join(taskDir, "payload.bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	total := int64(7)
	_, _, err := (HTTP{Dir: dir}).InspectTask(context.Background(), completedDownloadTask("task-1", "http", "https://example.com/payload.bin", total))
	if err == nil || !strings.Contains(err.Error(), "is a directory") {
		t.Fatalf("expected directory result error, got %v", err)
	}
}
