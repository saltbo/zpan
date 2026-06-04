package worker

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
	"github.com/saltbo/zpan/downloader/internal/config"
	"github.com/saltbo/zpan/downloader/internal/engine"
)

func TestResolveEngineRejectsUnknownConfiguredEngine(t *testing.T) {
	w := New(config.Config{Engine: "bad-engine"})

	err := w.resolveEngine(context.Background())
	if err == nil {
		t.Fatal("expected unsupported engine error")
	}
	if !strings.Contains(err.Error(), "bad-engine") {
		t.Fatalf("expected error to mention configured engine, got %v", err)
	}
}

func TestUploadFileSendsContentLength(t *testing.T) {
	path := writeTempFile(t, "hello world")
	var contentLength string
	var contentDisposition string
	var uploaded int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentLength = r.Header.Get("Content-Length")
		contentDisposition = r.Header.Get("Content-Disposition")
		if r.TransferEncoding != nil {
			t.Fatalf("expected fixed-length upload, got transfer encoding %v", r.TransferEncoding)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	if err := uploadFile(context.Background(), server.URL, path, `attachment; filename="hello.txt"`, func(written int64) error {
		uploaded += written
		return nil
	}); err != nil {
		t.Fatalf("uploadFile returned error: %v", err)
	}
	if contentLength != "11" {
		t.Fatalf("expected Content-Length 11, got %q", contentLength)
	}
	if contentDisposition != `attachment; filename="hello.txt"` {
		t.Fatalf("expected Content-Disposition header, got %q", contentDisposition)
	}
	if uploaded != 11 {
		t.Fatalf("expected uploaded bytes 11, got %d", uploaded)
	}
}

func TestUploadFileIncludesErrorBody(t *testing.T) {
	path := writeTempFile(t, "hello")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "signature mismatch", http.StatusForbidden)
	}))
	defer server.Close()

	err := uploadFile(context.Background(), server.URL, path, "", nil)
	if err == nil {
		t.Fatal("expected uploadFile error")
	}
	if !strings.Contains(err.Error(), "403 Forbidden") || !strings.Contains(err.Error(), "signature mismatch") {
		t.Fatalf("expected status and response body in error, got %v", err)
	}
}

func TestCollectDirectoryEntriesSkipsDownloadSidecars(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "movie.mkv"), []byte("movie"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "fixture.torrent"), []byte("torrent"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "movie.mkv.aria2"), []byte("control"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "[METADATA]abc"), []byte("metadata"), 0o644); err != nil {
		t.Fatal(err)
	}

	entries, err := collectDirectoryEntries(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected one uploaded entry, got %#v", entries)
	}
	if entries[0].name != "movie.mkv" {
		t.Fatalf("expected movie.mkv, got %s", entries[0].name)
	}
}

func TestUploadETARoundsRemainingSeconds(t *testing.T) {
	eta := uploadETA(&uploadProgress{uploaded: 25, totalBytes: 100}, 20)

	if eta == nil || *eta != 4 {
		t.Fatalf("expected ETA 4, got %#v", eta)
	}
}

func TestWithDownloadETAAddsFallback(t *testing.T) {
	total := int64(100)
	detail := withDownloadETA(&client.DownloadTaskDetail{Engine: "builtin"}, 25, &total, 20)

	if detail == nil || detail.ETASeconds == nil || *detail.ETASeconds != 4 {
		t.Fatalf("expected fallback ETA 4, got %#v", detail)
	}
	if detail.Engine != "builtin" {
		t.Fatalf("expected existing detail fields to be preserved, got %#v", detail)
	}
}

func TestWithDownloadETAPreservesEngineETA(t *testing.T) {
	total := int64(100)
	existing := int64(9)
	detail := withDownloadETA(&client.DownloadTaskDetail{ETASeconds: &existing}, 25, &total, 20)

	if detail == nil || detail.ETASeconds == nil || *detail.ETASeconds != 9 {
		t.Fatalf("expected engine ETA to be preserved, got %#v", detail)
	}
}

func TestUploadETAOmitsUnusableValues(t *testing.T) {
	cases := []struct {
		name     string
		progress *uploadProgress
		bps      int64
	}{
		{name: "missing progress", progress: nil, bps: 1},
		{name: "unknown total", progress: &uploadProgress{uploaded: 25}, bps: 1},
		{name: "complete", progress: &uploadProgress{uploaded: 100, totalBytes: 100}, bps: 1},
		{name: "stalled", progress: &uploadProgress{uploaded: 25, totalBytes: 100}, bps: 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if eta := uploadETA(tc.progress, tc.bps); eta != nil {
				t.Fatalf("expected empty ETA, got %#v", eta)
			}
		})
	}
}

func TestTaskErrorMessageTruncatesToSchemaLimit(t *testing.T) {
	err := errors.New(strings.Repeat("x", maxTaskErrorMessageLength+100))

	msg := taskErrorMessage(err)
	if len(msg) != maxTaskErrorMessageLength {
		t.Fatalf("expected message length %d, got %d", maxTaskErrorMessageLength, len(msg))
	}
	if !strings.HasSuffix(msg, "...") {
		t.Fatalf("expected truncated message to end with ellipsis, got %q", msg[len(msg)-10:])
	}
}

func TestRetainSeedKeepsDownloadedResult(t *testing.T) {
	dir := t.TempDir()
	cleaned := false
	w := New(config.Config{SeedEnabled: true, SeedDuration: time.Hour})

	retained := w.retainSeed(
		clientTask("task-1"),
		engine.Result{
			Path: filepath.Join(dir, "result"),
			Seed: &engine.Seed{
				Engine: "aria2",
				ID:     "gid",
				Path:   dir,
				Snapshot: func(context.Context) (engine.SeedSnapshot, error) {
					return engine.SeedSnapshot{}, nil
				},
				Cleanup: func(context.Context) error {
					cleaned = true
					return nil
				},
			},
		},
		w.logger,
	)

	if !retained {
		t.Fatal("expected bt result to be retained")
	}
	if cleaned {
		t.Fatal("expected retained seed cleanup to be deferred")
	}
	if len(w.retainedSeedSnapshot()) != 1 {
		t.Fatalf("expected one retained seed, got %d", len(w.retainedSeedSnapshot()))
	}
}

func TestCleanupRetainedSeedsRemovesExpiredSeed(t *testing.T) {
	dir := t.TempDir()
	w := New(config.Config{SeedEnabled: true, SeedDuration: time.Hour})
	cleaned := false
	w.retainedSeeds = []retainedSeed{{
		taskID:    "task-1",
		engine:    "aria2",
		seedID:    "gid",
		path:      dir,
		expiresAt: time.Now().Add(-time.Second),
		snapshot: func(context.Context) (engine.SeedSnapshot, error) {
			return engine.SeedSnapshot{}, nil
		},
		cleanup: func(context.Context) error {
			cleaned = true
			return nil
		},
	}}

	w.cleanupRetainedSeeds(context.Background())

	if !cleaned {
		t.Fatal("expected expired seed to be cleaned")
	}
	if len(w.retainedSeedSnapshot()) != 0 {
		t.Fatalf("expected retained seed to be removed, got %d", len(w.retainedSeedSnapshot()))
	}
}

func TestCleanupRetainedSeedsRemovesOldestWhenCacheLimitExceeded(t *testing.T) {
	root := t.TempDir()
	oldDir := filepath.Join(root, "old")
	newDir := filepath.Join(root, "new")
	if err := os.MkdirAll(oldDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldDir, "old.bin"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(newDir, "new.bin"), []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}

	var cleaned []string
	w := New(config.Config{SeedEnabled: true, SeedCacheLimit: 3})
	w.retainedSeeds = []retainedSeed{
		{
			taskID:     "old",
			engine:     "qbittorrent",
			seedID:     "old-hash",
			path:       oldDir,
			retainedAt: time.Now().Add(-time.Hour),
			snapshot: func(context.Context) (engine.SeedSnapshot, error) {
				return engine.SeedSnapshot{}, nil
			},
			cleanup: func(context.Context) error {
				cleaned = append(cleaned, "old")
				return nil
			},
		},
		{
			taskID:     "new",
			engine:     "qbittorrent",
			seedID:     "new-hash",
			path:       newDir,
			retainedAt: time.Now(),
			snapshot: func(context.Context) (engine.SeedSnapshot, error) {
				return engine.SeedSnapshot{}, nil
			},
			cleanup: func(context.Context) error {
				cleaned = append(cleaned, "new")
				return nil
			},
		},
	}

	w.cleanupRetainedSeeds(context.Background())

	if len(cleaned) != 1 || cleaned[0] != "old" {
		t.Fatalf("expected oldest seed to be cleaned first, got %v", cleaned)
	}
	seeds := w.retainedSeedSnapshot()
	if len(seeds) != 1 || seeds[0].taskID != "new" {
		t.Fatalf("expected newest seed to remain, got %+v", seeds)
	}
}

func writeTempFile(t *testing.T, content string) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "upload-*")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(content); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return file.Name()
}

func clientTask(id string) client.DownloadTask {
	return client.DownloadTask{ID: id, SourceType: "magnet"}
}
