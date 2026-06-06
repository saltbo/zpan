package worker

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
	"github.com/saltbo/zpan/downloader/internal/config"
	"github.com/saltbo/zpan/downloader/internal/engine"
)

func TestResolveEngineRejectsUnknownConfiguredEngine(t *testing.T) {
	w := NewWithAPI(config.Config{Engine: "bad-engine"}, nil)

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

func TestUploadFilePartSendsSectionAndReturnsETag(t *testing.T) {
	path := writeTempFile(t, "hello multipart")
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	var contentLength string
	var body string
	var uploaded int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentLength = r.Header.Get("Content-Length")
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		body = string(data)
		w.Header().Set("ETag", `"part-etag"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	etag, err := uploadFilePart(context.Background(), server.URL, file, 6, 9, func(written int64) error {
		uploaded += written
		return nil
	})
	if err != nil {
		t.Fatalf("uploadFilePart returned error: %v", err)
	}
	if contentLength != "9" {
		t.Fatalf("expected Content-Length 9, got %q", contentLength)
	}
	if body != "multipart" {
		t.Fatalf("expected section body, got %q", body)
	}
	if etag != `"part-etag"` {
		t.Fatalf("expected ETag, got %q", etag)
	}
	if uploaded != 9 {
		t.Fatalf("expected uploaded bytes 9, got %d", uploaded)
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

func TestUploadFailurePersistsDownloadCheckpoint(t *testing.T) {
	api := &recordingAPI{createFolderErr: errors.New("unauthorized")}
	w := NewWithAPI(config.Config{}, api)
	result := engine.Result{
		Path:  t.TempDir(),
		Name:  "album",
		Size:  1234,
		IsDir: true,
	}

	w.uploadAndComplete(
		context.Background(),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		clientTaskWithUploadToken("task-1", "downloading"),
		result,
		nil,
	)

	if len(api.patches) < 2 {
		t.Fatalf("expected uploading and failed updates, got %d", len(api.patches))
	}
	failed := api.patches[len(api.patches)-1]
	if failed.State() != "failed" {
		t.Fatalf("expected failed status, got %q", failed.State())
	}
	if failed.Progress == nil || failed.Progress.Download == nil || failed.Progress.Download.Bytes != result.Size {
		t.Fatalf("expected downloaded bytes %d, got %#v", result.Size, failed.Progress)
	}
	if failed.Progress.Download.TotalBytes == nil || *failed.Progress.Download.TotalBytes != result.Size {
		t.Fatalf("expected total bytes %d, got %#v", result.Size, failed.Progress.Download.TotalBytes)
	}
	if failed.Runtime == nil || failed.Runtime.Phase != "uploading" {
		t.Fatalf("expected uploading detail phase, got %#v", failed.Runtime)
	}
}

func TestWorkerLifecycleRetriesUploadWithoutRedownloading(t *testing.T) {
	payloadPath := writeTempFile(t, "downloaded payload")
	payloadSize := int64(len("downloaded payload"))
	uploadRequests := 0
	uploadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uploadRequests++
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer uploadServer.Close()

	api := &recordingAPI{
		createObjectDraft: client.ObjectDraft{ID: "object-1", Name: "payload.bin", UploadURL: uploadServer.URL},
		confirmErrs:       []error{errors.New("unauthorized"), nil},
	}
	eng := &recordingEngine{
		downloadResult: engine.Result{Path: payloadPath, Name: "payload.bin", Size: payloadSize},
		taskSnapshot: engine.TaskSnapshot{
			State:  engine.TaskStateCompleted,
			Result: &engine.Result{Path: payloadPath, Name: "payload.bin", Size: payloadSize},
		},
		taskFound: true,
	}

	first := NewWithAPI(config.Config{}, api)
	first.engine = eng
	first.process(context.Background(), clientHTTPTask("task-1", "assigned", "https://example.com/payload.bin", "payload.bin"))
	failed := lastPatchWithStatus(t, api.patches, "failed")
	if failed.Progress == nil || failed.Progress.Download == nil || failed.Progress.Download.Bytes != payloadSize {
		t.Fatalf("expected failed task to persist downloaded bytes %d, got %#v", payloadSize, failed.Progress)
	}
	if failed.Runtime == nil || failed.Runtime.Phase != "uploading" {
		t.Fatalf("expected failed task to persist uploading phase, got %#v", failed.Runtime)
	}

	second := NewWithAPI(config.Config{}, api)
	second.engine = eng
	second.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientHTTPTask("task-1", "assigned", "https://example.com/payload.bin", "payload.bin"), payloadSize, &payloadSize),
		&client.DownloadTaskRuntime{Phase: "uploading"},
	))

	if eng.downloadCalls != 1 {
		t.Fatalf("expected retry to avoid a second download, got %d download calls", eng.downloadCalls)
	}
	if eng.inspectCalls != 1 {
		t.Fatalf("expected retry to inspect the runtime task, got %d inspect calls", eng.inspectCalls)
	}
	if uploadRequests != 2 {
		t.Fatalf("expected both attempts to upload the local result, got %d upload requests", uploadRequests)
	}
	last := api.patches[len(api.patches)-1]
	if last.State() != "completed" {
		t.Fatalf("expected retry to complete task, got last patch %#v", last)
	}
}

func TestWorkerLifecycleRetriesHTTPUploadFromCheckpointWithoutRedownloading(t *testing.T) {
	payload := "downloaded payload"
	downloadRequests := 0
	downloadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		downloadRequests++
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write([]byte(payload))
	}))
	defer downloadServer.Close()

	uploadRequests := 0
	uploadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uploadRequests++
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer uploadServer.Close()

	api := &recordingAPI{
		createObjectDraft: client.ObjectDraft{ID: "object-1", Name: "payload.bin", UploadURL: uploadServer.URL},
		confirmErrs:       []error{errors.New("unauthorized"), nil},
	}
	downloadDir := t.TempDir()
	payloadSize := int64(len(payload))

	first := NewWithAPI(config.Config{}, api)
	first.engine = engine.HTTP{Dir: downloadDir}
	first.process(context.Background(), clientHTTPTask("task-1", "assigned", downloadServer.URL+"/payload.bin", "payload.bin"))
	failed := lastPatchWithStatus(t, api.patches, "failed")
	if failed.Progress == nil || failed.Progress.Download == nil || failed.Progress.Download.Bytes != payloadSize {
		t.Fatalf("expected failed task to persist downloaded bytes %d, got %#v", payloadSize, failed.Progress)
	}
	if downloadRequests != 1 {
		t.Fatalf("expected initial attempt to download once, got %d requests", downloadRequests)
	}

	second := NewWithAPI(config.Config{}, api)
	second.engine = engine.HTTP{Dir: downloadDir}
	second.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientHTTPTask("task-1", "assigned", downloadServer.URL+"/payload.bin", "payload.bin"), payloadSize, &payloadSize),
		&client.DownloadTaskRuntime{Phase: "uploading"},
	))

	if downloadRequests != 1 {
		t.Fatalf("expected retry not to request download source again, got %d requests", downloadRequests)
	}
	if uploadRequests != 2 {
		t.Fatalf("expected both attempts to upload the local file, got %d upload requests", uploadRequests)
	}
	last := api.patches[len(api.patches)-1]
	if last.State() != "completed" {
		t.Fatalf("expected retry to complete task, got last patch %#v", last)
	}
}

func TestUploadExistingResultInspectErrorFailsWithoutRedownloading(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{inspectErr: errors.New("runtime state is inconsistent")}
	w := NewWithAPI(config.Config{}, api)
	w.engine = eng

	total := int64(100)
	w.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientTaskWithUploadToken("task-1", "assigned"), 0, &total),
		&client.DownloadTaskRuntime{Phase: "uploading"},
	))

	if eng.downloadCalls != 0 {
		t.Fatalf("expected runtime inspection failure not to restart download, got %d download calls", eng.downloadCalls)
	}
	failed := lastPatchWithStatus(t, api.patches, "failed")
	if failed.ErrorMessage == nil || !strings.Contains(*failed.ErrorMessage, "runtime state is inconsistent") {
		t.Fatalf("expected runtime inspection error to be reported, got %#v", failed.ErrorMessage)
	}
}

func TestUploadExistingResultInspectPanicFailsWithoutRedownloading(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{inspectPanic: "runtime invariant violated"}
	w := NewWithAPI(config.Config{}, api)
	w.engine = eng

	total := int64(100)
	w.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientTaskWithUploadToken("task-1", "assigned"), 0, &total),
		&client.DownloadTaskRuntime{Phase: "uploading"},
	))

	if eng.downloadCalls != 0 {
		t.Fatalf("expected runtime inspection panic not to restart download, got %d download calls", eng.downloadCalls)
	}
	failed := lastPatchWithStatus(t, api.patches, "failed")
	if failed.ErrorMessage == nil || !strings.Contains(*failed.ErrorMessage, "panic: runtime invariant violated") {
		t.Fatalf("expected panic to be reported, got %#v", failed.ErrorMessage)
	}
}

func TestUploadExistingResultMissingRuntimeFailsWithoutRedownloading(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{taskFound: false}
	w := NewWithAPI(config.Config{}, api)
	w.engine = eng

	total := int64(100)
	w.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientTaskWithUploadToken("task-1", "assigned"), 0, &total),
		&client.DownloadTaskRuntime{Phase: "uploading"},
	))

	if eng.downloadCalls != 0 {
		t.Fatalf("expected missing runtime task not to restart download, got %d download calls", eng.downloadCalls)
	}
	failed := lastPatchWithStatus(t, api.patches, "failed")
	if failed.ErrorMessage == nil || !strings.Contains(*failed.ErrorMessage, "missing from downloader runtime") {
		t.Fatalf("expected missing runtime to be reported, got %#v", failed.ErrorMessage)
	}
}

func TestUploadExistingResultIncompleteRuntimeTaskFailsWithoutRedownloading(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{
		taskSnapshot: engine.TaskSnapshot{State: engine.TaskStateDownloading, Downloaded: 10},
		taskFound:    true,
	}
	w := NewWithAPI(config.Config{}, api)
	w.engine = eng

	total := int64(100)
	w.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientTaskWithUploadToken("task-1", "assigned"), 0, &total),
		&client.DownloadTaskRuntime{Phase: "uploading"},
	))

	if eng.downloadCalls != 0 {
		t.Fatalf("expected incomplete runtime task not to restart download, got %d download calls", eng.downloadCalls)
	}
	failed := lastPatchWithStatus(t, api.patches, "failed")
	if failed.ErrorMessage == nil || !strings.Contains(*failed.ErrorMessage, "server task requires upload but runtime task is not completed") {
		t.Fatalf("expected invariant failure to be reported, got %#v", failed.ErrorMessage)
	}
}

func TestDownloadShutdownMarksTaskInterrupted(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{downloadErr: context.Canceled}
	w := NewWithAPI(config.Config{}, api)
	w.engine = eng

	w.process(context.Background(), clientTaskWithStatus("task-1", "downloading"))

	patch := lastPatchWithStatus(t, api.patches, "interrupted")
	if patch.Progress == nil || patch.Progress.Download == nil || patch.Progress.Download.BytesPerSecond != 0 {
		t.Fatalf("expected download speed to be reset, got %#v", patch.Progress)
	}
	if patch.Runtime == nil || patch.Runtime.Message == "" {
		t.Fatalf("expected interrupted detail message, got %#v", patch.Runtime)
	}
}

func TestUploadShutdownMarksTaskInterrupted(t *testing.T) {
	payloadPath := writeTempFile(t, "downloaded payload")
	api := &recordingAPI{
		createObjectDraft: client.ObjectDraft{ID: "object-1", Name: "payload.bin", UploadURL: "http://127.0.0.1:1"},
	}
	w := NewWithAPI(config.Config{}, api)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w.uploadAndComplete(
		ctx,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		clientTaskWithUploadToken("task-1", "downloading"),
		engine.Result{Path: payloadPath, Name: "payload.bin", Size: int64(len("downloaded payload"))},
		nil,
	)

	patch := lastPatchWithStatus(t, api.patches, "interrupted")
	if patch.Progress == nil || patch.Progress.Download == nil || patch.Progress.Download.Bytes != int64(len("downloaded payload")) {
		t.Fatalf("expected upload shutdown to preserve downloaded checkpoint, got %#v", patch.Progress)
	}
	if patch.Runtime == nil || patch.Runtime.Phase != "uploading" || patch.Runtime.Message == "" {
		t.Fatalf("expected upload shutdown to preserve phase and add interrupted message, got %#v", patch.Runtime)
	}
	if _, ok := findPatchWithStatus(api.patches, "failed"); ok {
		t.Fatalf("expected upload shutdown not to mark failed, got %#v", api.patches)
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
	detail := withDownloadRuntime(&client.DownloadTaskRuntime{Engine: "builtin"}, 25, &total, 20)

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
	detail := withDownloadRuntime(&client.DownloadTaskRuntime{ETASeconds: &existing}, 25, &total, 20)

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

func TestNextTaskWorkStage(t *testing.T) {
	total := int64(100)
	cases := []struct {
		name string
		task client.DownloadTask
		want taskWorkStage
	}{
		{
			name: "uploading status",
			task: clientTaskWithStatus("task-1", "uploading"),
			want: taskWorkStageUploadExistingResult,
		},
		{
			name: "assigned with upload bytes",
			task: func() client.DownloadTask {
				task := clientTaskWithStatus("task-1", "assigned")
				task.Status.Progress.Upload.Bytes = 1
				return task
			}(),
			want: taskWorkStageUploadExistingResult,
		},
		{
			name: "assigned with uploading phase",
			task: withRuntime(clientTaskWithStatus("task-1", "assigned"), &client.DownloadTaskRuntime{Phase: "uploading"}),
			want: taskWorkStageUploadExistingResult,
		},
		{
			name: "assigned with completed phase",
			task: withRuntime(clientTaskWithStatus("task-1", "assigned"), &client.DownloadTaskRuntime{Phase: "completed"}),
			want: taskWorkStageUploadExistingResult,
		},
		{
			name: "assigned with completed download bytes",
			task: withDownloadCheckpoint(clientTaskWithStatus("task-1", "assigned"), 100, &total),
			want: taskWorkStageUploadExistingResult,
		},
		{
			name: "assigned partial download",
			task: withDownloadCheckpoint(clientTaskWithStatus("task-1", "assigned"), 99, &total),
			want: taskWorkStageDownload,
		},
		{
			name: "downloading completed bytes",
			task: withDownloadCheckpoint(clientTaskWithStatus("task-1", "downloading"), 100, &total),
			want: taskWorkStageUploadExistingResult,
		},
		{
			name: "downloading partial download",
			task: withDownloadCheckpoint(clientTaskWithStatus("task-1", "downloading"), 99, &total),
			want: taskWorkStageDownload,
		},
		{
			name: "interrupted with uploading phase",
			task: withRuntime(clientTaskWithStatus("task-1", "interrupted"), &client.DownloadTaskRuntime{Phase: "uploading"}),
			want: taskWorkStageUploadExistingResult,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := nextTaskWorkStage(tc.task); got != tc.want {
				t.Fatalf("expected %v, got %v", tc.want, got)
			}
		})
	}
}

func TestRetainSeedKeepsDownloadedResult(t *testing.T) {
	dir := t.TempDir()
	stateDir := t.TempDir()
	cleaned := false
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedDuration: time.Hour, StateDir: stateDir}, nil)

	retained := w.retainSeed(
		clientTask("task-1"),
		engine.Result{
			Path: filepath.Join(dir, "result"),
			Size: 123,
			Seed: &engine.Seed{
				Engine:   "aria2",
				ID:       "gid",
				InfoHash: "infohash",
				Path:     dir,
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
	ledger, err := loadSeedLedger(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(ledger.Seeds) != 1 || ledger.Seeds[0].TaskID != "task-1" || ledger.Seeds[0].InfoHash != "infohash" {
		t.Fatalf("expected retained seed ledger entry, got %#v", ledger.Seeds)
	}
}

func TestRestoreRetainedSeedsLoadsLedger(t *testing.T) {
	stateDir := t.TempDir()
	seedPath := t.TempDir()
	retainedAt := time.Now().Add(-time.Minute)
	if err := saveSeedLedger(stateDir, seedLedger{Seeds: []seedLedgerEntry{{
		TaskID:     "task-1",
		Engine:     "aria2",
		SeedID:     "old-gid",
		InfoHash:   "abc123",
		Path:       seedPath,
		Size:       456,
		RetainedAt: retainedAt,
		ExpiresAt:  time.Now().Add(time.Hour),
	}}}); err != nil {
		t.Fatal(err)
	}
	eng := &recordingEngine{restoreSeed: &engine.Seed{
		Engine:   "aria2",
		ID:       "new-gid",
		InfoHash: "abc123",
		Path:     seedPath,
		Snapshot: func(context.Context) (engine.SeedSnapshot, error) {
			return engine.SeedSnapshot{}, nil
		},
		Cleanup: func(context.Context) error {
			return nil
		},
	}}
	w := NewWithAPI(config.Config{SeedEnabled: true, StateDir: stateDir}, nil)
	w.engine = eng

	w.restoreRetainedSeeds(context.Background())

	seeds := w.retainedSeedSnapshot()
	if len(seeds) != 1 {
		t.Fatalf("expected one restored seed, got %#v", seeds)
	}
	if seeds[0].seedID != "new-gid" || seeds[0].path != seedPath || !seeds[0].retainedAt.Equal(retainedAt) {
		t.Fatalf("unexpected restored seed: %#v", seeds[0])
	}
	if eng.restoreCalls != 1 {
		t.Fatalf("expected one restore call, got %d", eng.restoreCalls)
	}
}

func TestRestoreRetainedSeedsDoesNotDuplicateAlreadyRestoredSeed(t *testing.T) {
	stateDir := t.TempDir()
	seedPath := t.TempDir()
	if err := saveSeedLedger(stateDir, seedLedger{Seeds: []seedLedgerEntry{{
		TaskID:     "task-1",
		Engine:     "aria2",
		SeedID:     "gid",
		InfoHash:   "abc123",
		Path:       seedPath,
		Size:       456,
		RetainedAt: time.Now().Add(-time.Minute),
		ExpiresAt:  time.Now().Add(time.Hour),
	}}}); err != nil {
		t.Fatal(err)
	}
	eng := &recordingEngine{restoreSeed: &engine.Seed{
		Engine:   "aria2",
		ID:       "gid",
		InfoHash: "abc123",
		Path:     seedPath,
		Snapshot: func(context.Context) (engine.SeedSnapshot, error) {
			return engine.SeedSnapshot{}, nil
		},
		Cleanup: func(context.Context) error {
			return nil
		},
	}}
	w := NewWithAPI(config.Config{SeedEnabled: true, StateDir: stateDir}, nil)
	w.engine = eng

	w.restoreRetainedSeeds(context.Background())
	w.restoreRetainedSeeds(context.Background())

	if got := len(w.retainedSeedSnapshot()); got != 1 {
		t.Fatalf("expected one restored seed, got %d", got)
	}
	if eng.restoreCalls != 1 {
		t.Fatalf("expected restore to skip existing seed, got %d calls", eng.restoreCalls)
	}
}

func TestCleanupRetainedSeedsRemovesExpiredSeed(t *testing.T) {
	dir := t.TempDir()
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedDuration: time.Hour}, nil)
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

func TestCleanupRetainedSeedsRemovesSeedAfterRatio(t *testing.T) {
	dir := t.TempDir()
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedRatio: 1.5}, nil)
	cleaned := false
	uploaded := int64(151)
	w.retainedSeeds = []retainedSeed{{
		taskID:     "task-1",
		engine:     "aria2",
		seedID:     "gid",
		path:       dir,
		downloaded: 100,
		snapshot: func(context.Context) (engine.SeedSnapshot, error) {
			return engine.SeedSnapshot{
				Runtime: &client.DownloadTaskRuntime{
					Seeding: &client.DownloadTaskSeedingRuntime{UploadedBytes: &uploaded},
				},
			}, nil
		},
		cleanup: func(context.Context) error {
			cleaned = true
			return nil
		},
	}}

	w.cleanupRetainedSeeds(context.Background())

	if !cleaned {
		t.Fatal("expected ratio seed to be cleaned")
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
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedCacheLimit: 3}, nil)
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
	return client.DownloadTask{
		ID: id,
		Spec: client.DownloadTaskSpec{
			Source: client.DownloadTaskSource{Type: "magnet"},
			Labels: client.DownloadTaskLabels{Tags: []string{}},
		},
		Status: client.DownloadTaskStatus{},
	}
}

func clientTaskWithStatus(id string, status string) client.DownloadTask {
	task := clientTask(id)
	task.Status.State = status
	return task
}

func clientTaskWithUploadToken(id string, status string) client.DownloadTask {
	task := clientTaskWithStatus(id, status)
	task.Status.Assignment = &client.DownloadTaskAssignment{DownloaderID: "downloader-1", UploadToken: "upload-token"}
	return task
}

func clientHTTPTask(id string, status string, uri string, name string) client.DownloadTask {
	task := clientTaskWithUploadToken(id, status)
	task.Spec.Source = client.DownloadTaskSource{Type: "http", URI: uri}
	task.Spec.Destination.Name = name
	return task
}

func withDownloadCheckpoint(task client.DownloadTask, bytes int64, total *int64) client.DownloadTask {
	task.Status.Progress.Download = client.DownloadTaskTransferProgress{Bytes: bytes, TotalBytes: total}
	return task
}

func withRuntime(task client.DownloadTask, runtime *client.DownloadTaskRuntime) client.DownloadTask {
	task.Status.Runtime = runtime
	return task
}

func lastPatchWithStatus(t *testing.T, patches []client.TaskPatch, status string) client.TaskPatch {
	t.Helper()
	patch, ok := findPatchWithStatus(patches, status)
	if !ok {
		t.Fatalf("expected patch with status %q in %#v", status, patches)
	}
	return patch
}

func findPatchWithStatus(patches []client.TaskPatch, status string) (client.TaskPatch, bool) {
	for i := len(patches) - 1; i >= 0; i-- {
		if patches[i].State() == status {
			return patches[i], true
		}
	}
	return client.TaskPatch{}, false
}

type recordingEngine struct {
	downloadResult engine.Result
	downloadErr    error
	taskSnapshot   engine.TaskSnapshot
	inspectErr     error
	inspectPanic   any
	taskFound      bool
	restoreSeed    *engine.Seed
	downloadCalls  int
	inspectCalls   int
	restoreCalls   int
}

func (e *recordingEngine) Name() string {
	return "recording"
}

func (e *recordingEngine) Capabilities() []string {
	return []string{"http", "magnet", "torrent"}
}

func (e *recordingEngine) Check(context.Context) error {
	return nil
}

func (e *recordingEngine) InspectTask(context.Context, client.DownloadTask) (engine.TaskSnapshot, bool, error) {
	e.inspectCalls++
	if e.inspectPanic != nil {
		panic(e.inspectPanic)
	}
	if e.inspectErr != nil {
		return engine.TaskSnapshot{}, false, e.inspectErr
	}
	return e.taskSnapshot, e.taskFound, nil
}

func (e *recordingEngine) RestoreSeed(context.Context, engine.SeedRef) (*engine.Seed, error) {
	e.restoreCalls++
	return e.restoreSeed, nil
}

func (e *recordingEngine) Download(context.Context, client.DownloadTask, engine.Progress) (engine.Result, error) {
	e.downloadCalls++
	return e.downloadResult, e.downloadErr
}

type recordingAPI struct {
	patches           []client.TaskPatch
	createFolderErr   error
	createObjectDraft client.ObjectDraft
	confirmErrs       []error
}

func (a *recordingAPI) Heartbeat(context.Context, client.Heartbeat) error {
	return nil
}

func (a *recordingAPI) AssignedControlTasks(context.Context) ([]client.DownloadTask, error) {
	return nil, nil
}

func (a *recordingAPI) AssignedTasks(context.Context) ([]client.DownloadTask, error) {
	return nil, nil
}

func (a *recordingAPI) UpdateTask(_ context.Context, id string, patch client.TaskPatch) (client.DownloadTask, error) {
	a.patches = append(a.patches, patch)
	task := clientTaskWithStatus(id, patch.State())
	task.Status.Runtime = patch.Runtime
	if patch.Progress != nil {
		if patch.Progress.Download != nil {
			task.Status.Progress.Download = *patch.Progress.Download
		}
		if patch.Progress.Upload != nil {
			task.Status.Progress.Upload = *patch.Progress.Upload
		}
	}
	return task, nil
}

func (a *recordingAPI) CreateFolder(context.Context, string, string, string) (client.ObjectDraft, error) {
	return client.ObjectDraft{}, a.createFolderErr
}

func (a *recordingAPI) CreateObject(context.Context, string, string, int64, string) (client.ObjectDraft, error) {
	return a.createObjectDraft, nil
}

func (a *recordingAPI) ConfirmObject(context.Context, string, string) error {
	if len(a.confirmErrs) > 0 {
		err := a.confirmErrs[0]
		a.confirmErrs = a.confirmErrs[1:]
		return err
	}
	return nil
}

func (a *recordingAPI) CreateObjectUploadSession(context.Context, string, string, int64) (client.ObjectUploadSession, error) {
	return client.ObjectUploadSession{}, nil
}

func (a *recordingAPI) PresignObjectUploadParts(context.Context, string, string, string, []int) ([]client.PresignedObjectUploadPart, error) {
	return nil, nil
}

func (a *recordingAPI) CompleteObjectUploadSession(context.Context, string, string, string, []client.CompletedObjectUploadPart) error {
	return nil
}

func (a *recordingAPI) AbortObjectUploadSession(context.Context, string, string, string) error {
	return nil
}
