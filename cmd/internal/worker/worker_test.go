package worker

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
	"github.com/saltbo/zpan/internal/engine"
)

func TestCancelRunningUsesCauseForControlState(t *testing.T) {
	cases := []struct {
		state string
		want  error
	}{
		{"pausing", errTaskPausing},
		{"canceling", errTaskCanceling},
		{"suspended", errTaskSuspended},
	}
	for _, tc := range cases {
		t.Run(tc.state, func(t *testing.T) {
			w := NewWithAPI(config.Config{MaxConcurrentTasks: 5}, &recordingAPI{})
			w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
			taskCtx, ok := w.startTask(context.Background(), "task-1")
			if !ok {
				t.Fatal("expected to start task")
			}
			defer w.finish("task-1")

			if !w.cancelRunning(clientTaskWithStatus("task-1", tc.state)) {
				t.Fatal("expected cancelRunning to act on a running task")
			}
			<-taskCtx.Done()
			if cause := context.Cause(taskCtx); !errors.Is(cause, tc.want) {
				t.Fatalf("expected cancel cause %v, got %v", tc.want, cause)
			}
		})
	}
}

func TestDownloadThenUploadStopsWhenSuspendedAtStart(t *testing.T) {
	api := &recordingAPI{suspendDownloading: true}
	w := NewWithAPI(config.Config{}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	eng := &recordingEngine{}
	w.engine = eng

	w.downloadThenUpload(context.Background(), w.logger, clientTaskWithStatus("task-1", "assigned"), nil)

	if eng.downloadCalls != 0 {
		t.Fatalf("expected no download when the task is suspended at start, got %d calls", eng.downloadCalls)
	}
}

func TestCanceledDownloadPreservesRuntimeAndMarksCanceled(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{downloadErr: context.Canceled}
	w := NewWithAPI(config.Config{}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = eng
	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errTaskCanceling)

	w.downloadThenUpload(ctx, w.logger, clientTaskWithStatus("task-1", "downloading"), nil)

	if eng.resetCalls != 0 {
		t.Fatalf("expected canceled task to preserve runtime, got %d reset calls", eng.resetCalls)
	}
	patch := lastPatchWithStatus(t, api.patches, "canceled")
	if patch.State() != "canceled" {
		t.Fatalf("expected canceled patch, got %#v", patch)
	}
}

func TestSuspendedDownloadPreservesRuntimeWithoutStatusChange(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{downloadErr: context.Canceled}
	w := NewWithAPI(config.Config{}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = eng
	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errTaskSuspended)

	w.downloadThenUpload(ctx, w.logger, clientTaskWithStatus("task-1", "downloading"), nil)

	if eng.resetCalls != 0 {
		t.Fatalf("expected suspended task to preserve runtime, got %d reset calls", eng.resetCalls)
	}
	if _, ok := findPatchWithStatus(api.patches, "suspended"); ok {
		t.Fatalf("expected worker not to overwrite server-owned suspended status, got %#v", api.patches)
	}
	for _, patch := range api.patches {
		if patch.Runtime != nil && patch.Runtime.State == localResultRemovedRuntimeState {
			t.Fatalf("expected suspended task not to mark local result removed, got %#v", patch.Runtime)
		}
	}
}

func TestTickSuspendedControlTaskPreservesRuntime(t *testing.T) {
	api := &recordingAPI{
		controlTasks: []client.DownloadTask{clientTaskWithStatus("task-1", "suspended")},
	}
	eng := &recordingEngine{}
	w := NewWithAPI(config.Config{}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = eng

	if err := w.tick(context.Background()); err != nil {
		t.Fatalf("first tick: %v", err)
	}
	if eng.resetCalls != 0 {
		t.Fatalf("expected suspended control poll to preserve runtime, got %d reset calls", eng.resetCalls)
	}
	if len(api.patches) != 0 {
		t.Fatalf("expected suspended control poll not to patch task, got %#v", api.patches)
	}

	if err := w.tick(context.Background()); err != nil {
		t.Fatalf("second tick: %v", err)
	}
	if eng.resetCalls != 0 {
		t.Fatalf("expected repeated suspended control polls not to clean runtime, got %d reset calls", eng.resetCalls)
	}
	if len(api.patches) != 0 {
		t.Fatalf("expected repeated suspended control polls not to patch task, got %#v", api.patches)
	}
	if got := api.controlTasks[0].State(); got != "suspended" {
		t.Fatalf("expected recorded control task status to stay suspended, got %q", got)
	}
}

func TestTickUsesHeartbeatNextPollInterval(t *testing.T) {
	api := &recordingAPI{nextPollAfterSeconds: 17}
	w := NewWithAPI(config.Config{PollInterval: time.Second}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))

	nextPoll, err := w.tickAndNextPoll(context.Background())
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if nextPoll != 17*time.Second {
		t.Fatalf("expected server-directed poll interval, got %s", nextPoll)
	}
}

func TestDeleteRequestedControlTaskCleansRuntimeAndAcksCanceled(t *testing.T) {
	api := &recordingAPI{
		controlTasks: []client.DownloadTask{
			withRuntime(clientTaskWithStatus("task-1", "canceling"), &client.DownloadTaskRuntime{State: deleteRequestedRuntimeState}),
		},
	}
	eng := &recordingEngine{}
	w := NewWithAPI(config.Config{}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = eng

	if err := w.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if eng.resetCalls != 1 {
		t.Fatalf("expected delete-requested task to clean runtime once, got %d reset calls", eng.resetCalls)
	}
	patch := lastPatchWithStatus(t, api.patches, "canceled")
	if patch.State() != "canceled" {
		t.Fatalf("expected delete-requested cleanup to ack canceled, got %#v", patch)
	}
}

func TestCancelingControlTaskWithoutDeleteRequestPreservesRuntime(t *testing.T) {
	api := &recordingAPI{
		controlTasks: []client.DownloadTask{clientTaskWithStatus("task-1", "canceling")},
	}
	eng := &recordingEngine{}
	w := NewWithAPI(config.Config{}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = eng

	if err := w.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if eng.resetCalls != 0 {
		t.Fatalf("expected canceling task without delete request to preserve runtime, got %d reset calls", eng.resetCalls)
	}
	patch := lastPatchWithStatus(t, api.patches, "canceled")
	if patch.State() != "canceled" {
		t.Fatalf("expected canceling task to ack canceled, got %#v", patch)
	}
}

func TestFailedDownloadPreservesRuntimeAndMarksFailed(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{downloadErr: errors.New("disk write failed")}
	w := NewWithAPI(config.Config{}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = eng

	w.downloadThenUpload(context.Background(), w.logger, clientTaskWithStatus("task-1", "downloading"), nil)

	if eng.resetCalls != 0 {
		t.Fatalf("expected failed task to preserve runtime, got %d reset calls", eng.resetCalls)
	}
	failed := lastPatchWithStatus(t, api.patches, "failed")
	if failed.ErrorMessage == nil || !strings.Contains(*failed.ErrorMessage, "disk write failed") {
		t.Fatalf("expected failure message to be reported, got %#v", failed.ErrorMessage)
	}
}

func TestTerminalDownloadStopsPreservePartialFiles(t *testing.T) {
	cases := []struct {
		name          string
		cancelCause   error
		failedMessage string
		wantStatus    string
		requireStop   bool
	}{
		{
			name:        "canceled",
			cancelCause: errTaskCanceling,
			wantStatus:  "canceled",
		},
		{
			name:        "suspended",
			cancelCause: errTaskSuspended,
			requireStop: true,
		},
		{
			name:          "failed",
			failedMessage: "disk write failed",
			wantStatus:    "failed",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			api := &recordingAPI{}
			downloadDir := t.TempDir()
			partialPath := filepath.Join(downloadDir, "task-1", "payload.bin")
			ready := make(chan struct{}, 1)
			eng := &recordingEngine{
				downloadFunc: func(ctx context.Context, task client.DownloadTask, progress engine.Progress) (engine.Result, error) {
					if err := os.MkdirAll(filepath.Dir(partialPath), 0o755); err != nil {
						return engine.Result{}, err
					}
					if err := os.WriteFile(partialPath, []byte("partial"), 0o644); err != nil {
						return engine.Result{}, err
					}
					ready <- struct{}{}
					if tc.failedMessage != "" {
						return engine.Result{}, errors.New(tc.failedMessage)
					}
					<-ctx.Done()
					return engine.Result{}, ctx.Err()
				},
				resetTaskFn: func(context.Context, client.DownloadTask) error {
					return os.RemoveAll(filepath.Join(downloadDir, "task-1"))
				},
			}
			w := NewWithAPI(config.Config{DownloadDir: downloadDir}, api)
			w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
			w.engine = eng

			task := clientHTTPTask("task-1", "downloading", "https://example.com/payload.bin", "payload.bin")
			if tc.cancelCause != nil {
				ctx, cancel := context.WithCancelCause(context.Background())
				done := make(chan struct{})
				go func() {
					w.downloadThenUpload(ctx, w.logger, task, nil)
					close(done)
				}()
				select {
				case <-ready:
				case <-time.After(5 * time.Second):
					t.Fatal("timed out waiting for partial download")
				}
				cancel(tc.cancelCause)
				waitForWorkerTestCompletion(t, done)
			} else {
				w.downloadThenUpload(context.Background(), w.logger, task, nil)
			}

			if tc.wantStatus != "" {
				lastPatchWithStatus(t, api.patches, tc.wantStatus)
			}
			taskDir := filepath.Join(downloadDir, task.ID)
			if _, err := os.Stat(taskDir); err != nil {
				t.Fatalf("expected %s to remain after %s stop, got err=%v", taskDir, tc.name, err)
			}
			if tc.requireStop {
				for _, forbidden := range []string{"failed", "interrupted", "canceled", "paused"} {
					if _, ok := findPatchWithStatus(api.patches, forbidden); ok {
						t.Fatalf("expected suspended stop not to emit %q, got %#v", forbidden, api.patches)
					}
				}
			}
		})
	}
}

func TestWatchEngineProcessFatalOnUnexpectedExit(t *testing.T) {
	w := NewWithAPI(config.Config{}, nil)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	runCtx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	w.cancelRun = cancel

	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start managed process stub: %v", err)
	}
	done := make(chan struct{})
	go func() {
		w.watchEngineProcess("aria2", cmd)
		close(done)
	}()
	// Simulate the engine dying out from under the worker.
	_ = cmd.Process.Kill()

	select {
	case <-runCtx.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("expected run context to be cancelled after the engine exits")
	}
	if cause := context.Cause(runCtx); !errors.Is(cause, errEngineExited) {
		t.Fatalf("expected errEngineExited cause, got %v", cause)
	}
	<-done
}

func TestWatchEngineProcessQuietOnDeliberateStop(t *testing.T) {
	w := NewWithAPI(config.Config{}, nil)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	runCtx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	w.cancelRun = cancel
	w.markStopping()

	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start managed process stub: %v", err)
	}
	_ = cmd.Process.Kill()
	w.watchEngineProcess("aria2", cmd)

	if cause := context.Cause(runCtx); cause != nil {
		t.Fatalf("expected run context to stay live during a deliberate stop, got %v", cause)
	}
}

func TestClearStaleSeedingReportsClearsUntrackedOnly(t *testing.T) {
	api := &recordingAPI{seedingTasks: []client.DownloadTask{
		clientTaskWithStatus("stale-task", "completed"),
		clientTaskWithStatus("live-seed", "completed"),
	}}
	w := NewWithAPI(config.Config{SeedEnabled: true}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = &recordingEngine{}
	w.retainedSeeds = []retainedSeed{{taskID: "live-seed"}}

	w.clearStaleSeedingReports(context.Background())

	if len(api.patchedIDs) != 1 || api.patchedIDs[0] != "stale-task" {
		t.Fatalf("expected exactly the untracked task to be cleared, got %v", api.patchedIDs)
	}
	patch := api.patches[0]
	if patch.Runtime == nil || patch.Runtime.Phase != "completed" {
		t.Fatalf("expected completed-phase runtime, got %#v", patch.Runtime)
	}
	if patch.Runtime.Seeding == nil || patch.Runtime.Seeding.Active == nil || *patch.Runtime.Seeding.Active {
		t.Fatal("expected seeding.active=false in the stopped report")
	}
}

func TestCleanupRetainedSeedReportsStopped(t *testing.T) {
	api := &recordingAPI{}
	w := NewWithAPI(config.Config{SeedEnabled: true}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = &recordingEngine{}
	cleaned := false
	w.retainedSeeds = []retainedSeed{{
		taskID:  "seed-task",
		engine:  "aria2",
		cleanup: func(context.Context) error { cleaned = true; return nil },
	}}

	w.cleanupRetainedSeed(context.Background(), w.retainedSeeds[0], "expired")

	if !cleaned {
		t.Fatal("expected engine cleanup to run")
	}
	if len(api.patchedIDs) != 1 || api.patchedIDs[0] != "seed-task" {
		t.Fatalf("expected a stopped report for the cleaned seed, got %v", api.patchedIDs)
	}
	if patch := api.patches[0]; patch.Runtime == nil || patch.Runtime.Seeding == nil ||
		patch.Runtime.Seeding.Active == nil || *patch.Runtime.Seeding.Active {
		t.Fatalf("expected seeding cleared in cleanup report, got %#v", patch.Runtime)
	}
}

func TestReconcileEngineSeedsDoesNotFetchAssignedTasksWithoutLocalSeeds(t *testing.T) {
	api := &recordingAPI{}
	w := NewWithAPI(config.Config{SeedEnabled: true}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = &recordingEngine{}

	w.reconcileEngineSeeds(context.Background())

	if api.assignedTasksCalls != 0 {
		t.Fatalf("expected no assigned-task fetch without local seeds, got %d", api.assignedTasksCalls)
	}
}

func TestReconcileEngineSeedsAdoptsUntrackedOrphans(t *testing.T) {
	root := t.TempDir()
	orphanDir := filepath.Join(root, "orphan-task")
	if err := os.MkdirAll(orphanDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(orphanDir, "file.bin"), make([]byte, 1024), 0o644); err != nil {
		t.Fatal(err)
	}
	trackedDir := filepath.Join(root, "tracked-task")
	runningDir := filepath.Join(root, "running-task")
	assignedDir := filepath.Join(root, "assigned-task")
	for _, dir := range []string{trackedDir, runningDir, assignedDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	eng := &recordingEngine{listSeeds: []engine.Seed{
		{Engine: "aria2", ID: "g1", InfoHash: "AAAA", Path: orphanDir},
		{Engine: "aria2", ID: "g2", InfoHash: "BBBB", Path: trackedDir},
		{Engine: "aria2", ID: "g3", InfoHash: "CCCC", Path: runningDir},
		{Engine: "aria2", ID: "g4", InfoHash: "DDDD", Path: assignedDir},
	}}
	// 'assigned-task' is still assigned/unfinished — it auto-seeds but hasn't been
	// uploaded yet, so the reconciler must NOT adopt it as a done seed.
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedDuration: time.Hour}, &recordingAPI{
		assignedTasks: []client.DownloadTask{{ID: "assigned-task"}},
	})
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = eng
	w.retainedSeeds = []retainedSeed{{taskID: "tracked-task"}}
	w.running["running-task"] = func(error) {}

	w.reconcileEngineSeeds(context.Background())

	for _, seed := range w.retainedSeedSnapshot() {
		if seed.taskID == "assigned-task" {
			t.Fatal("expected an assigned (not-yet-uploaded) task's seed to be skipped, not adopted")
		}
	}

	got := map[string]retainedSeed{}
	trackedCount := 0
	for _, seed := range w.retainedSeedSnapshot() {
		got[seed.taskID] = seed
		if seed.taskID == "tracked-task" {
			trackedCount++
		}
	}
	orphan, adopted := got["orphan-task"]
	if !adopted {
		t.Fatal("expected the untracked orphan seed to be adopted")
	}
	if orphan.expiresAt.IsZero() {
		t.Fatal("expected the adopted orphan to receive an expiry")
	}
	if orphan.size != 1024 {
		t.Fatalf("expected adopted orphan size 1024, got %d", orphan.size)
	}
	if _, ok := got["running-task"]; ok {
		t.Fatal("expected the in-flight running task to be skipped, not adopted")
	}
	if trackedCount != 1 {
		t.Fatalf("expected the already-tracked seed to stay single, got %d", trackedCount)
	}
}

func TestHeartbeatReportsAggregateTransferSpeeds(t *testing.T) {
	w := NewWithAPI(config.Config{Engine: "auto", MaxConcurrentTasks: 5, DownloadDir: t.TempDir()}, &recordingAPI{})

	if _, ok := w.startTask(context.Background(), "task-1"); !ok {
		t.Fatal("expected task-1 to start")
	}
	if _, ok := w.startTask(context.Background(), "task-2"); !ok {
		t.Fatal("expected task-2 to start")
	}
	w.setTaskTransferSpeed("task-1", transferSpeeds{downloadBps: 100, uploadBps: 20})
	w.setTaskTransferSpeed("task-2", transferSpeeds{downloadBps: 300, uploadBps: 40})

	heartbeat := w.heartbeat()
	if heartbeat.CurrentTasks != 2 {
		t.Fatalf("expected 2 current tasks, got %d", heartbeat.CurrentTasks)
	}
	if heartbeat.DownloadBps != 400 || heartbeat.UploadBps != 60 {
		t.Fatalf("expected aggregate speeds 400/60, got %d/%d", heartbeat.DownloadBps, heartbeat.UploadBps)
	}
	if heartbeat.FreeDiskBytes <= 0 {
		t.Fatalf("expected heartbeat to report free disk bytes, got %d", heartbeat.FreeDiskBytes)
	}

	w.finish("task-1")
	heartbeat = w.heartbeat()
	if heartbeat.CurrentTasks != 1 {
		t.Fatalf("expected 1 current task after finish, got %d", heartbeat.CurrentTasks)
	}
	if heartbeat.DownloadBps != 300 || heartbeat.UploadBps != 40 {
		t.Fatalf("expected finished task speed to be removed, got %d/%d", heartbeat.DownloadBps, heartbeat.UploadBps)
	}
	w.finish("task-2")
}

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

func TestExplicitlyConfiguredExternalEngineRejectsAmbiguousRuntimeConfig(t *testing.T) {
	_, _, err := explicitlyConfiguredExternalEngine(config.Config{
		Aria2Configured:       true,
		QBittorrentConfigured: true,
		Aria2URL:              config.DefaultAria2URL,
		QBittorrentURL:        config.DefaultQBittorrentURL,
	}, nil)
	if err == nil {
		t.Fatal("expected ambiguous external runtime config error")
	}
}

func TestExplicitlyConfiguredExternalEngineSelectsConfiguredRuntime(t *testing.T) {
	downloader, ok, err := explicitlyConfiguredExternalEngine(config.Config{
		Aria2Configured: true,
		Aria2URL:        "ws://aria2:6800/jsonrpc",
		DownloadDir:     t.TempDir(),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected configured external runtime")
	}
	if downloader.Name() != "aria2" {
		t.Fatalf("expected aria2 runtime, got %q", downloader.Name())
	}
}

func TestUploadFilePartSendsContentLength(t *testing.T) {
	path := writeTempFile(t, "hello world")
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
		if r.TransferEncoding != nil {
			t.Fatalf("expected fixed-length upload, got transfer encoding %v", r.TransferEncoding)
		}
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		body = string(data)
		w.Header().Set("ETag", `"etag-1"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	etag, err := uploadFilePart(context.Background(), server.URL, file, 0, 11, func(written int64) error {
		uploaded += written
		return nil
	})
	if err != nil {
		t.Fatalf("uploadFilePart returned error: %v", err)
	}
	if contentLength != "11" {
		t.Fatalf("expected Content-Length 11, got %q", contentLength)
	}
	if body != "hello world" {
		t.Fatalf("expected uploaded body, got %q", body)
	}
	if etag != `"etag-1"` {
		t.Fatalf("expected ETag, got %q", etag)
	}
	if uploaded != 11 {
		t.Fatalf("expected uploaded bytes 11, got %d", uploaded)
	}
}

func TestUploadFilePartIncludesErrorBody(t *testing.T) {
	path := writeTempFile(t, "hello")
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "signature mismatch", http.StatusForbidden)
	}))
	defer server.Close()

	_, err = uploadFilePart(context.Background(), server.URL, file, 0, 5, nil)
	if err == nil {
		t.Fatal("expected uploadFilePart error")
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

func TestCleanupDownloadedResultRemovesTaskDirForNestedDirectoryResult(t *testing.T) {
	downloadDir := t.TempDir()
	taskDir := filepath.Join(downloadDir, "task-1")
	resultDir := filepath.Join(taskDir, "payload")
	if err := os.MkdirAll(resultDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resultDir, "file.txt"), []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "payload.torrent"), []byte("sidecar"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := cleanupDownloadedResult(context.Background(), clientTaskWithStatus("task-1", "downloading"), engine.Result{
		Path:  resultDir,
		Name:  "payload",
		IsDir: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(taskDir); !os.IsNotExist(err) {
		t.Fatalf("expected nested directory result cleanup to remove task dir, stat err=%v", err)
	}
}

func TestUploadFailurePersistsDownloadCheckpoint(t *testing.T) {
	api := &recordingAPI{createFolderErr: errors.New("unauthorized")}
	w := NewWithAPI(config.Config{}, api)
	resultPath := t.TempDir()
	result := engine.Result{
		Path:  resultPath,
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
	if failed.Runtime != nil && failed.Runtime.State == localResultRemovedRuntimeState {
		t.Fatalf("expected upload failure to preserve local result runtime, got %#v", failed.Runtime)
	}
	if _, err := os.Stat(resultPath); err != nil {
		t.Fatalf("expected upload failure to preserve local result path, stat err=%v", err)
	}
}

func TestWorkerLifecycleUploadFailurePreservesLocalResult(t *testing.T) {
	payloadPath := writeTempFile(t, "downloaded payload")
	payloadSize := int64(len("downloaded payload"))
	uploadRequests := 0
	uploadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uploadRequests++
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("ETag", `"etag-1"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer uploadServer.Close()

	api := &recordingAPI{
		createObjectDraft: client.ObjectDraft{ID: "object-1", Name: "payload.bin", Upload: &client.ObjectUploadInstructions{SessionID: "session-1", PartSize: payloadSize, URLs: []string{uploadServer.URL}}},
		completeErrs:      []error{errors.New("unauthorized"), nil},
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
	if failed.Runtime != nil && failed.Runtime.State == localResultRemovedRuntimeState {
		t.Fatalf("expected failed task to preserve local result runtime, got %#v", failed.Runtime)
	}
	if uploadRequests != 1 {
		t.Fatalf("expected one upload attempt, got %d", uploadRequests)
	}
	if _, err := os.Stat(payloadPath); err != nil {
		t.Fatalf("expected failed upload to preserve local payload, stat err=%v", err)
	}
}

func TestWorkerLifecycleHTTPUploadFailurePreservesLocalResult(t *testing.T) {
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
		w.Header().Set("ETag", `"etag-1"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer uploadServer.Close()

	payloadSize := int64(len(payload))
	api := &recordingAPI{
		createObjectDraft: client.ObjectDraft{ID: "object-1", Name: "payload.bin", Upload: &client.ObjectUploadInstructions{SessionID: "session-1", PartSize: payloadSize, URLs: []string{uploadServer.URL}}},
		completeErrs:      []error{errors.New("unauthorized"), nil},
	}
	downloadDir := t.TempDir()

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
	if uploadRequests != 1 {
		t.Fatalf("expected one upload attempt, got %d", uploadRequests)
	}
	if _, err := os.Stat(filepath.Join(downloadDir, "task-1")); err != nil {
		t.Fatalf("expected failed upload to preserve local task directory, stat err=%v", err)
	}

	second := NewWithAPI(config.Config{}, api)
	second.engine = engine.HTTP{Dir: downloadDir}
	failedRuntime := failed.Runtime
	second.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientHTTPTask("task-1", "assigned", downloadServer.URL+"/payload.bin", "payload.bin"), payloadSize, &payloadSize),
		failedRuntime,
	))

	if downloadRequests != 1 {
		t.Fatalf("expected retry after upload failure to reuse local result, got %d download requests", downloadRequests)
	}
	if uploadRequests != 2 {
		t.Fatalf("expected retry to upload preserved file, got %d upload requests", uploadRequests)
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

func TestUploadExistingResultIncompleteRuntimeResumesDownload(t *testing.T) {
	// The server checkpoint can route a task to "upload the finished download"
	// while the engine isn't reporting it complete yet — e.g. aria2 re-checking
	// on-disk files after a restart. That must resume the download path, not
	// panic/fail the task.
	api := &recordingAPI{}
	eng := &recordingEngine{
		taskSnapshot: engine.TaskSnapshot{State: engine.TaskStateDownloading, Downloaded: 10},
		taskFound:    true,
		downloadErr:  errors.New("resumed via download path"),
	}
	w := NewWithAPI(config.Config{}, api)
	w.engine = eng

	total := int64(100)
	w.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientTaskWithUploadToken("task-1", "assigned"), 0, &total),
		&client.DownloadTaskRuntime{Phase: "uploading"},
	))

	if eng.downloadCalls != 1 {
		t.Fatalf("expected incomplete runtime to resume via the download path, got %d download calls", eng.downloadCalls)
	}
	for _, p := range api.patches {
		if p.Status == "failed" && p.ErrorMessage != nil && strings.Contains(*p.ErrorMessage, "not completed") {
			t.Fatalf("expected no upload-invariant failure, got %q", *p.ErrorMessage)
		}
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
	if eng.resetCalls != 0 {
		t.Fatalf("expected interrupted shutdown to preserve resumable runtime data, got %d resets", eng.resetCalls)
	}
}

func TestUploadShutdownMarksTaskInterrupted(t *testing.T) {
	payloadPath := writeTempFile(t, "downloaded payload")
	payloadSize := int64(len("downloaded payload"))
	api := &recordingAPI{
		createObjectDraft: client.ObjectDraft{ID: "object-1", Name: "payload.bin", Upload: &client.ObjectUploadInstructions{SessionID: "session-1", PartSize: payloadSize, URLs: []string{"http://127.0.0.1:1"}}},
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

func TestSuspendedUploadPreservesLocalResult(t *testing.T) {
	downloadDir := t.TempDir()
	taskDir := filepath.Join(downloadDir, "task-1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	payloadPath := filepath.Join(taskDir, "payload.bin")
	payload := "downloaded payload"
	if err := os.WriteFile(payloadPath, []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	payloadSize := int64(len(payload))
	api := &recordingAPI{
		createObjectDraft: client.ObjectDraft{ID: "object-1", Name: "payload.bin", Upload: &client.ObjectUploadInstructions{SessionID: "session-1", PartSize: payloadSize, URLs: []string{"http://127.0.0.1:1"}}},
	}
	w := NewWithAPI(config.Config{}, api)

	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errTaskSuspended)
	w.uploadAndComplete(
		ctx,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		clientTaskWithUploadToken("task-1", "downloading"),
		engine.Result{Path: payloadPath, Name: "payload.bin", Size: payloadSize},
		&client.DownloadTaskRuntime{Phase: "uploading"},
	)

	if _, ok := findPatchWithStatus(api.patches, "suspended"); ok {
		t.Fatalf("expected worker not to overwrite server-owned suspended status, got %#v", api.patches)
	}
	for _, patch := range api.patches {
		if patch.Runtime != nil && patch.Runtime.State == localResultRemovedRuntimeState {
			t.Fatalf("expected suspended upload not to mark local result removed, got %#v", patch.Runtime)
		}
	}
	if _, err := os.Stat(taskDir); err != nil {
		t.Fatalf("expected suspended upload to preserve local task directory, stat err=%v", err)
	}
}

func TestProcessRedownloadsWhenLocalResultWasCleaned(t *testing.T) {
	api := &recordingAPI{}
	eng := &recordingEngine{downloadErr: errors.New("redownload missing local result")}
	w := NewWithAPI(config.Config{}, api)
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	w.engine = eng
	total := int64(100)

	w.process(context.Background(), withRuntime(
		withDownloadCheckpoint(clientTaskWithStatus("task-1", "assigned"), total, &total),
		&client.DownloadTaskRuntime{Phase: "error", State: localResultRemovedRuntimeState},
	))

	if eng.inspectCalls != 0 {
		t.Fatalf("expected cleaned local result to skip runtime upload inspection, got %d inspect calls", eng.inspectCalls)
	}
	if eng.downloadCalls != 1 {
		t.Fatalf("expected cleaned local result to resume via download path, got %d download calls", eng.downloadCalls)
	}
	failed := lastPatchWithStatus(t, api.patches, "failed")
	if failed.ErrorMessage == nil || !strings.Contains(*failed.ErrorMessage, "redownload missing local result") {
		t.Fatalf("expected resumed redownload failure to be reported, got %#v", failed.ErrorMessage)
	}
}

func TestPausedAndInterruptedDownloadsPreservePartialFiles(t *testing.T) {
	cases := []struct {
		name       string
		cancelCtx  func(context.CancelCauseFunc, context.CancelFunc)
		wantStatus string
	}{
		{
			name: "paused",
			cancelCtx: func(cancelCause context.CancelCauseFunc, _ context.CancelFunc) {
				cancelCause(errTaskPausing)
			},
			wantStatus: "paused",
		},
		{
			name: "interrupted",
			cancelCtx: func(_ context.CancelCauseFunc, cancel context.CancelFunc) {
				cancel()
			},
			wantStatus: "interrupted",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			api := &recordingAPI{}
			downloadDir := t.TempDir()
			path := filepath.Join(downloadDir, "task-1", "payload.bin")
			ready := make(chan struct{}, 1)
			eng := &recordingEngine{
				downloadFunc: func(ctx context.Context, task client.DownloadTask, progress engine.Progress) (engine.Result, error) {
					if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
						return engine.Result{}, err
					}
					if err := os.WriteFile(path, []byte("partial"), 0o644); err != nil {
						return engine.Result{}, err
					}
					ready <- struct{}{}
					<-ctx.Done()
					return engine.Result{}, ctx.Err()
				},
				resetTaskFn: func(context.Context, client.DownloadTask) error {
					return os.RemoveAll(filepath.Join(downloadDir, "task-1"))
				},
			}

			w := NewWithAPI(config.Config{DownloadDir: downloadDir}, api)
			w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
			w.engine = eng

			ctx, cancel := context.WithCancel(context.Background())
			ctxWithCause, cancelCause := context.WithCancelCause(ctx)
			done := make(chan struct{})
			go func() {
				w.downloadThenUpload(ctxWithCause, w.logger, clientHTTPTask("task-1", "downloading", "https://example.com/payload.bin", "payload.bin"), nil)
				close(done)
			}()

			select {
			case <-ready:
			case <-time.After(5 * time.Second):
				t.Fatal("timed out waiting for partial download")
			}
			tc.cancelCtx(cancelCause, cancel)
			waitForWorkerTestCompletion(t, done)

			lastPatchWithStatus(t, api.patches, tc.wantStatus)
			info, err := os.Stat(path)
			if err != nil {
				t.Fatalf("expected resumable file %s to remain, got %v", path, err)
			}
			if info.Size() == 0 {
				t.Fatalf("expected resumable file %s to keep partial content", path)
			}
		})
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
			name: "assigned with removed local result marker",
			task: withRuntime(
				withDownloadCheckpoint(clientTaskWithStatus("task-1", "assigned"), 100, &total),
				&client.DownloadTaskRuntime{Phase: "error", State: localResultRemovedRuntimeState},
			),
			want: taskWorkStageDownload,
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

func TestResetTaskForRestartAttemptResetsRuntimeAndRecordsAttempt(t *testing.T) {
	stateDir := t.TempDir()
	seedPath := t.TempDir()
	if err := saveSeedLedger(stateDir, seedLedger{Seeds: []seedLedgerEntry{{
		TaskID:     "task-1",
		Engine:     "aria2",
		SeedID:     "gid",
		InfoHash:   "abc123",
		Path:       seedPath,
		RetainedAt: time.Now().Add(-time.Minute),
		ExpiresAt:  time.Now().Add(time.Hour),
	}}}); err != nil {
		t.Fatal(err)
	}
	task := clientTaskWithStatus("task-1", "assigned")
	task.Status.Attempt = 2
	eng := &recordingEngine{}
	w := NewWithAPI(config.Config{StateDir: stateDir}, nil)
	w.engine = eng

	if err := w.resetTaskForAttempt(context.Background(), task, w.logger); err != nil {
		t.Fatal(err)
	}

	if eng.resetCalls != 1 {
		t.Fatalf("expected reset once, got %d", eng.resetCalls)
	}
	attempts, err := loadAttemptLedger(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if attempts.Attempts["task-1"] != 2 {
		t.Fatalf("expected attempt 2 to be recorded, got %#v", attempts.Attempts)
	}
	seedLedger, err := loadSeedLedger(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(seedLedger.Seeds) != 0 {
		t.Fatalf("expected restart to remove retained seed ledger, got %#v", seedLedger.Seeds)
	}
}

func TestResetTaskForRestartAttemptSkipsAlreadyRecordedAttempt(t *testing.T) {
	stateDir := t.TempDir()
	if err := saveAttemptLedger(stateDir, attemptLedger{Attempts: map[string]int{"task-1": 2}}); err != nil {
		t.Fatal(err)
	}
	task := clientTaskWithStatus("task-1", "assigned")
	task.Status.Attempt = 2
	eng := &recordingEngine{}
	w := NewWithAPI(config.Config{StateDir: stateDir}, nil)
	w.engine = eng

	if err := w.resetTaskForAttempt(context.Background(), task, w.logger); err != nil {
		t.Fatal(err)
	}
	if eng.resetCalls != 0 {
		t.Fatalf("expected no reset for recorded attempt, got %d", eng.resetCalls)
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

func TestRetainedSeedExpiresWhenLedgerPersistenceFails(t *testing.T) {
	stateFile := filepath.Join(t.TempDir(), "state-file")
	if err := os.WriteFile(stateFile, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	cleaned := false
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedDuration: time.Hour, StateDir: stateFile}, &recordingAPI{})
	w.engine = &recordingEngine{}

	retained := w.retainSeed(
		clientTask("task-1"),
		engine.Result{
			Path: filepath.Join(t.TempDir(), "result"),
			Size: 123,
			Seed: &engine.Seed{
				Engine:   "aria2",
				ID:       "gid",
				InfoHash: "infohash",
				Path:     t.TempDir(),
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
		t.Fatal("expected seed to remain tracked in memory")
	}
	if len(w.retainedSeedSnapshot()) != 1 {
		t.Fatalf("expected retained seed despite ledger failure, got %d", len(w.retainedSeedSnapshot()))
	}
	w.retainedSeeds[0].expiresAt = time.Now().Add(-time.Second)

	w.cleanupRetainedSeeds(context.Background())

	if !cleaned {
		t.Fatal("expected in-memory retained seed to expire and clean up")
	}
	if len(w.retainedSeedSnapshot()) != 0 {
		t.Fatalf("expected expired seed to be removed from memory, got %d", len(w.retainedSeedSnapshot()))
	}
}

func TestReportRetainedSeedsCleansMissingSeed(t *testing.T) {
	cleaned := false
	w := NewWithAPI(config.Config{SeedEnabled: true}, &recordingAPI{})
	w.engine = &recordingEngine{}
	w.retainedSeeds = []retainedSeed{{
		taskID: "task-1",
		engine: "aria2",
		seedID: "missing-gid",
		snapshot: func(context.Context) (engine.SeedSnapshot, error) {
			return engine.SeedSnapshot{}, errors.New("GID missing-gid is not found")
		},
		cleanup: func(context.Context) error {
			cleaned = true
			return nil
		},
	}}

	w.reportRetainedSeeds(context.Background())

	if !cleaned {
		t.Fatal("expected missing retained seed to be cleaned")
	}
	if got := len(w.retainedSeedSnapshot()); got != 0 {
		t.Fatalf("expected missing retained seed to be removed, got %d", got)
	}
}

func TestReportRetainedSeedsSendsCompleteSeedingSnapshot(t *testing.T) {
	api := &recordingAPI{}
	w := NewWithAPI(config.Config{SeedEnabled: true}, api)
	total := int64(100)
	eta := int64(30)
	uploaded := int64(12)
	w.retainedSeeds = []retainedSeed{{
		taskID:     "task-1",
		engine:     "aria2",
		seedID:     "gid",
		size:       total,
		downloaded: total,
		snapshot: func(context.Context) (engine.SeedSnapshot, error) {
			return engine.SeedSnapshot{
				Downloaded: total,
				Total:      &total,
				Runtime: &client.DownloadTaskRuntime{
					Engine:     "aria2",
					Phase:      "seeding",
					ETASeconds: &eta,
					Seeding:    &client.DownloadTaskSeedingRuntime{UploadedBytes: &uploaded},
				},
			}, nil
		},
		cleanup: func(context.Context) error { return nil },
	}}

	w.reportRetainedSeeds(context.Background())

	patch := api.patches[len(api.patches)-1]
	if patch.Runtime == nil || patch.Runtime.ETASeconds != nil {
		t.Fatalf("expected seeding runtime without ETA, got %#v", patch.Runtime)
	}
	if patch.Runtime.Progress == nil ||
		patch.Runtime.Progress.Download.Bytes != total ||
		patch.Runtime.Progress.Upload.Bytes != total {
		t.Fatalf("expected complete transfer progress in seeding snapshot, got %#v", patch.Runtime.Progress)
	}
	if patch.Progress == nil || patch.Progress.Upload == nil || patch.Progress.Upload.Bytes != total {
		t.Fatalf("expected top-level upload progress to stay complete, got %#v", patch.Progress)
	}
}

func TestReportRetainedSeedsSkipsUnchangedSnapshot(t *testing.T) {
	api := &recordingAPI{}
	w := NewWithAPI(config.Config{SeedEnabled: true}, api)
	total := int64(100)
	uploaded := int64(12)
	w.retainedSeeds = []retainedSeed{{
		taskID:     "task-1",
		engine:     "aria2",
		seedID:     "gid",
		size:       total,
		downloaded: total,
		snapshot: func(context.Context) (engine.SeedSnapshot, error) {
			return engine.SeedSnapshot{
				Downloaded: total,
				Total:      &total,
				Runtime: &client.DownloadTaskRuntime{
					Engine:  "aria2",
					Phase:   "seeding",
					Seeding: &client.DownloadTaskSeedingRuntime{UploadedBytes: &uploaded},
				},
			}, nil
		},
		cleanup: func(context.Context) error { return nil },
	}}

	w.reportRetainedSeeds(context.Background())
	w.reportRetainedSeeds(context.Background())
	if len(api.patches) != 1 {
		t.Fatalf("expected unchanged seed snapshot to be reported once, got %d patches", len(api.patches))
	}

	uploaded = 24
	w.reportRetainedSeeds(context.Background())
	if len(api.patches) != 2 {
		t.Fatalf("expected changed seed snapshot to be reported again, got %d patches", len(api.patches))
	}
}

func TestReportRetainedSeedsStoppedClearsSeedingPhase(t *testing.T) {
	api := &recordingAPI{}
	w := NewWithAPI(config.Config{SeedEnabled: true}, api)
	total := int64(100)
	uploaded := int64(40)
	active := true
	w.retainedSeeds = []retainedSeed{{
		taskID:     "task-1",
		engine:     "aria2",
		seedID:     "gid",
		size:       total,
		downloaded: total,
		snapshot: func(context.Context) (engine.SeedSnapshot, error) {
			return engine.SeedSnapshot{
				Downloaded: total,
				Total:      &total,
				Runtime: &client.DownloadTaskRuntime{
					Engine:  "aria2",
					Phase:   "seeding",
					Seeding: &client.DownloadTaskSeedingRuntime{Active: &active, UploadedBytes: &uploaded},
				},
			}, nil
		},
		cleanup: func(context.Context) error { return nil },
	}}

	w.reportRetainedSeedsStopped(context.Background())

	patch := api.patches[len(api.patches)-1]
	if patch.Runtime == nil || patch.Runtime.Phase != "completed" {
		t.Fatalf("expected completed runtime, got %#v", patch.Runtime)
	}
	if patch.Runtime.Seeding == nil || patch.Runtime.Seeding.Active == nil || *patch.Runtime.Seeding.Active {
		t.Fatalf("expected inactive seeding detail, got %#v", patch.Runtime.Seeding)
	}
	if patch.Runtime.Seeding.UploadBytesPerSecond == nil || *patch.Runtime.Seeding.UploadBytesPerSecond != 0 {
		t.Fatalf("expected zero seeding upload speed, got %#v", patch.Runtime.Seeding)
	}
	if patch.Runtime.Progress == nil ||
		patch.Runtime.Progress.Download.Bytes != total ||
		patch.Runtime.Progress.Upload.Bytes != total {
		t.Fatalf("expected complete transfer progress, got %#v", patch.Runtime.Progress)
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
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedDuration: time.Hour}, &recordingAPI{})
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
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedRatio: 1.5}, &recordingAPI{})
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
	w := NewWithAPI(config.Config{SeedEnabled: true, SeedCacheLimit: 3}, &recordingAPI{})
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

func waitForWorkerTestCompletion(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for worker completion")
	}
}

func clientTask(id string) client.DownloadTask {
	return client.DownloadTask{
		ID: id,
		Spec: client.DownloadTaskSpec{
			Source: client.DownloadTaskSource{Type: "magnet"},
			Labels: client.DownloadTaskLabels{Tags: []string{}},
		},
		Status: client.DownloadTaskStatus{Attempt: 1},
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
	downloadFunc   func(context.Context, client.DownloadTask, engine.Progress) (engine.Result, error)
	resetErr       error
	resetTaskFn    func(context.Context, client.DownloadTask) error
	taskSnapshot   engine.TaskSnapshot
	inspectErr     error
	inspectPanic   any
	taskFound      bool
	restoreSeed    *engine.Seed
	listSeeds      []engine.Seed
	downloadCalls  int
	resetCalls     int
	inspectCalls   int
	restoreCalls   int
	listSeedsCalls int
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

func (e *recordingEngine) ListSeeds(context.Context) ([]engine.Seed, error) {
	e.listSeedsCalls++
	return e.listSeeds, nil
}

func (e *recordingEngine) ResetTask(ctx context.Context, task client.DownloadTask) error {
	e.resetCalls++
	if e.resetTaskFn != nil {
		return e.resetTaskFn(ctx, task)
	}
	return e.resetErr
}

func (e *recordingEngine) Download(ctx context.Context, task client.DownloadTask, progress engine.Progress) (engine.Result, error) {
	e.downloadCalls++
	if e.downloadFunc != nil {
		return e.downloadFunc(ctx, task, progress)
	}
	return e.downloadResult, e.downloadErr
}

type recordingAPI struct {
	patches              []client.TaskPatch
	patchedIDs           []string
	seedingTasks         []client.DownloadTask
	controlTasks         []client.DownloadTask
	assignedTasks        []client.DownloadTask
	assignedTasksCalls   int
	nextPollAfterSeconds int
	suspendDownloading   bool
	createFolderErr      error
	createObjectDraft    client.ObjectDraft
	completeErrs         []error
}

func (a *recordingAPI) Heartbeat(context.Context, client.Heartbeat) (client.HeartbeatResult, error) {
	nextPoll := a.nextPollAfterSeconds
	if nextPoll == 0 {
		nextPoll = 5
	}
	return client.HeartbeatResult{Assignments: a.assignedTasks, Controls: a.controlTasks, NextPollAfterSeconds: nextPoll}, nil
}

func (a *recordingAPI) AssignedTasks(context.Context) ([]client.DownloadTask, error) {
	a.assignedTasksCalls++
	return a.assignedTasks, nil
}

func (a *recordingAPI) SeedingTasks(context.Context) ([]client.DownloadTask, error) {
	return a.seedingTasks, nil
}

func (a *recordingAPI) UpdateTask(_ context.Context, id string, patch client.TaskPatch) (client.DownloadTask, error) {
	a.patches = append(a.patches, patch)
	a.patchedIDs = append(a.patchedIDs, id)
	state := patch.State()
	if a.suspendDownloading && state == "downloading" {
		state = "suspended"
	}
	recordedPatch := patch
	if state != patch.State() {
		recordedPatch.Status = state
	}
	applyRecordedTaskPatch(a.controlTasks, id, recordedPatch)
	applyRecordedTaskPatch(a.assignedTasks, id, recordedPatch)
	task := clientTaskWithStatus(id, state)
	task = applyTaskPatch(task, recordedPatch)
	return task, nil
}

func applyRecordedTaskPatch(tasks []client.DownloadTask, id string, patch client.TaskPatch) {
	for i := range tasks {
		if tasks[i].ID == id {
			tasks[i] = applyTaskPatch(tasks[i], patch)
		}
	}
}

func applyTaskPatch(task client.DownloadTask, patch client.TaskPatch) client.DownloadTask {
	if patch.State() != "" {
		task.Status.State = patch.State()
	}
	if patch.Runtime != nil {
		task.Status.Runtime = patch.Runtime
	}
	if patch.Progress != nil {
		if patch.Progress.Download != nil {
			task.Status.Progress.Download = *patch.Progress.Download
		}
		if patch.Progress.Upload != nil {
			task.Status.Progress.Upload = *patch.Progress.Upload
		}
	}
	return task
}

func (a *recordingAPI) CreateFolder(context.Context, string, string, string) (client.ObjectDraft, error) {
	return client.ObjectDraft{}, a.createFolderErr
}

func (a *recordingAPI) CreateObject(context.Context, string, string, int64, string) (client.ObjectDraft, error) {
	return a.createObjectDraft, nil
}

func (a *recordingAPI) CompleteObjectUpload(context.Context, string, string, string, []client.CompletedObjectUploadPart) error {
	if len(a.completeErrs) > 0 {
		err := a.completeErrs[0]
		a.completeErrs = a.completeErrs[1:]
		return err
	}
	return nil
}

func (a *recordingAPI) AbortObjectUploadSession(context.Context, string, string, string) error {
	return nil
}
