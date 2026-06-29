package downloader

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
)

func TestDownloadTaskAccessors(t *testing.T) {
	runtime := &TaskRuntime{Engine: "aria2", Phase: "downloading"}
	task := DownloadTask{
		ID:          "task-1",
		Source:      Source{Type: "magnet", URI: "magnet:?xt=urn:btih:abc"},
		Destination: Destination{Name: "movie.mkv"},
		Labels:      Labels{Category: "movies", Tags: []string{"hd", "bt"}},
		Status:      Status{State: "downloading", Runtime: runtime},
	}

	if task.SourceType() != "magnet" || task.SourceURI() == "" || task.Name() != "movie.mkv" {
		t.Fatalf("unexpected source/name accessors: %#v", task)
	}
	if task.Category() != "movies" || !reflect.DeepEqual(task.Tags(), []string{"hd", "bt"}) {
		t.Fatalf("unexpected labels: %#v", task.Labels)
	}
	if task.State() != "downloading" || task.Runtime() != runtime {
		t.Fatalf("unexpected status accessors: %#v", task.Status)
	}
}

func TestRuntimeMapperPreservesFullDetail(t *testing.T) {
	enabled := true
	active := true
	uploaded := int64(42)
	ratio := 1.25
	total := int64(100)
	completed := int64(80)
	selected := true
	progress := 0.5
	downBps := int64(20)
	upBps := int64(3)
	runtime := &TaskRuntime{
		Engine:      "aria2",
		Phase:       "seeding",
		State:       "active",
		Message:     "ok",
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
		Progress:    &RuntimeProgress{Download: TransferProgress{Bytes: 80, TotalBytes: &total, Bps: downBps}, Upload: TransferProgress{Bytes: 40, TotalBytes: &total, Bps: upBps}},
		ETASeconds:  ptrInt64(5),
		Connections: ptrInt64(9),
		Torrent:     &TorrentRuntime{InfoHash: "abc", Name: "torrent", Seeders: ptrInt64(10), Leechers: ptrInt64(2), Peers: ptrInt64(12)},
		Seeding:     &SeedingRuntime{Enabled: &enabled, Active: &active, UploadedBytes: &uploaded, UploadBytesPerSecond: &upBps, Ratio: &ratio, StartedAt: "start", ExpiresAt: "end"},
		Trackers:    []Tracker{{URL: "udp://tracker", Status: "working", Peers: ptrInt64(3), Seeds: ptrInt64(2), Leechers: ptrInt64(1), Message: "ok"}},
		Peers:       []Peer{{Address: "1.1.1.1:6881", Client: "peer", CountryCode: "US", RegionCode: "CA", Progress: &progress, DownloadBps: &downBps, UploadBps: &upBps}},
		Files:       []File{{Path: "movie.mkv", Size: total, CompletedBytes: &completed, Selected: &selected}},
	}

	zpan := zpanRuntime(runtime)
	roundTrip := downloaderRuntime(zpan)

	if !reflect.DeepEqual(roundTrip, runtime) {
		t.Fatalf("runtime mapping lost detail:\nwant %#v\ngot  %#v", runtime, roundTrip)
	}
	if got := zpanTransferProgress(TransferProgress{Bytes: 1, TotalBytes: &total, Bps: 2}); got.Bytes != 1 || got.TotalBytes == nil || *got.TotalBytes != total || got.BytesPerSecond != 2 {
		t.Fatalf("unexpected transfer progress mapping: %#v", got)
	}
}

func TestManagerLifecycleHelpers(t *testing.T) {
	first := &lifecycleDownloader{name: "aria2", sourceTypes: []string{"magnet"}}
	second := &lifecycleDownloader{name: "http", sourceTypes: []string{"http"}}
	manager := NewManagerWithDownloaders(first, second)

	if manager.Name() != "aria2" {
		t.Fatalf("expected BT manager name, got %q", manager.Name())
	}
	if !manager.isStarted() {
		t.Fatal("expected injected manager to be started")
	}
	manager.Stop(context.Background())
	if first.stopCalls != 1 || second.stopCalls != 1 {
		t.Fatalf("expected both downloaders to stop, got %d/%d", first.stopCalls, second.stopCalls)
	}
	if manager.isStarted() {
		t.Fatal("expected manager stopped")
	}

	empty := NewManager(config.Config{Engine: "qbittorrent"}, nil, nil)
	if empty.Name() != "qbittorrent" {
		t.Fatalf("expected configured name before start, got %q", empty.Name())
	}
	if !reflect.DeepEqual(empty.Capabilities(), []string{"http"}) {
		t.Fatalf("expected default http capability before start, got %#v", empty.Capabilities())
	}
	if len(NewManagerWithDownloaders().currentDownloaders()) != 0 {
		t.Fatal("expected empty downloader list")
	}
	var nilManager *Manager
	nilManager.Stop(context.Background())
	if nilManager.Name() != "auto" {
		t.Fatalf("expected nil manager name auto, got %q", nilManager.Name())
	}
	if err := nilManager.ready(); err == nil {
		t.Fatal("expected nil manager not ready")
	}
}

func TestManagerStartupCleanupOnLaterDownloaderFailure(t *testing.T) {
	registerTestDownloaders(t,
		testRegistration{name: "aria2"},
		testRegistration{name: "http", fallback: true},
	)
	original := registeredDownloaders
	registeredDownloaders = []registration{
		{
			name:       "aria2",
			configured: func(Config) bool { return false },
			new: func(Config) (Downloader, error) {
				return &lifecycleDownloader{name: "aria2", sourceTypes: []string{"magnet"}}, nil
			},
		},
		{
			name:       "http",
			fallback:   true,
			configured: func(Config) bool { return false },
			new: func(Config) (Downloader, error) {
				return &lifecycleDownloader{name: "http", sourceTypes: []string{"http"}, checkErr: errors.New("http unavailable")}, nil
			},
		},
	}
	t.Cleanup(func() { registeredDownloaders = original })

	manager := NewManager(config.Config{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	err := manager.Start(context.Background(), nil)
	if err == nil || !strings.Contains(err.Error(), "http") {
		t.Fatalf("expected startup failure from http downloader, got %v", err)
	}
}

func TestManagerStartDownloaderErrorBranches(t *testing.T) {
	manager := NewManager(config.Config{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	startErr := errors.New("start failed")
	if err := manager.startDownloader(context.Background(), &lifecycleDownloader{name: "bad", startErr: startErr}, false); !errors.Is(err, startErr) {
		t.Fatalf("expected non-required start error, got %v", err)
	}
	if err := manager.startDownloader(context.Background(), &lifecycleDownloader{name: "bad", startErr: startErr}, true); err == nil || !strings.Contains(err.Error(), "start downloader") {
		t.Fatalf("expected required start wrapper, got %v", err)
	}

	checkErr := errors.New("check failed")
	checkCtx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if err := manager.startDownloader(checkCtx, &lifecycleDownloader{name: "bad", checkErr: checkErr}, false); err == nil {
		t.Fatal("expected non-required check error")
	}
	checkCtx, cancel = context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if err := manager.startDownloader(checkCtx, &lifecycleDownloader{name: "bad", checkErr: checkErr}, true); err == nil || !strings.Contains(err.Error(), "not available") {
		t.Fatalf("expected required check wrapper, got %v", err)
	}
}

func TestTaskRunnerRunStartupFailures(t *testing.T) {
	downloadDirFile := filepath.Join(t.TempDir(), "download-dir")
	if err := os.WriteFile(downloadDirFile, []byte("not a dir"), 0o644); err != nil {
		t.Fatal(err)
	}
	runner := NewTaskRunnerWithAPI(config.Config{DownloadDir: downloadDirFile}, &recordingAPI{})
	err := runner.Run(context.Background())
	if err == nil {
		t.Fatal("expected download dir mkdir failure")
	}

	geoIPFile := filepath.Join(t.TempDir(), "invalid.mmdb")
	if err := os.WriteFile(geoIPFile, []byte("not a maxmind db"), 0o644); err != nil {
		t.Fatal(err)
	}
	runner = NewTaskRunnerWithAPI(config.Config{DownloadDir: t.TempDir(), GeoIPDBPath: geoIPFile}, &recordingAPI{})
	err = runner.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "open geoip database") {
		t.Fatalf("expected geoip open failure, got %v", err)
	}

	original := registeredDownloaders
	registeredDownloaders = nil
	t.Cleanup(func() { registeredDownloaders = original })
	runner = NewTaskRunnerWithAPI(config.Config{Engine: "http", DownloadDir: t.TempDir()}, &recordingAPI{})
	err = runner.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "http downloader is not registered") {
		t.Fatalf("expected missing http downloader error, got %v", err)
	}
}

func TestManagerWatchDownloaderExitPaths(t *testing.T) {
	manager := NewManagerWithDownloaders(&lifecycleDownloader{name: "http", sourceTypes: []string{"http"}})
	manager.watchDownloader(context.Background(), &lifecycleDownloader{name: "http", sourceTypes: []string{"http"}}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	manager.watchDownloader(ctx, &lifecycleDownloader{name: "http", sourceTypes: []string{"http"}}, func(error) {
		t.Fatal("did not expect exit callback after context cancellation")
	})

	errCh := make(chan error, 1)
	go manager.watchDownloader(context.Background(), &lifecycleDownloader{name: "http", sourceTypes: []string{"http"}, checkErr: errors.New("health failed")}, func(err error) {
		errCh <- err
	})
	select {
	case err := <-errCh:
		if err == nil || !strings.Contains(err.Error(), "health check failed") {
			t.Fatalf("expected health check failure, got %v", err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("timed out waiting for downloader health failure")
	}
}

func TestCleanupDownloadedResultBranches(t *testing.T) {
	seedCleaned := false
	err := cleanupDownloadedResult(context.Background(), clientTaskWithStatus("task-1", "completed"), Result{
		Seed: &Seed{Cleanup: func(context.Context) error {
			seedCleaned = true
			return nil
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !seedCleaned {
		t.Fatal("expected seed cleanup to be used")
	}

	file := writeTempFile(t, "payload")
	err = cleanupDownloadedResult(context.Background(), clientTaskWithStatus("task-1", "completed"), Result{Path: file})
	if err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(file); !os.IsNotExist(statErr) {
		t.Fatalf("expected file removal, got %v", statErr)
	}
}

func TestLedgerInvalidJSONAndEmptyFiles(t *testing.T) {
	stateDir := t.TempDir()
	if err := os.WriteFile(attemptLedgerPath(stateDir), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := loadAttemptLedger(stateDir); err == nil {
		t.Fatal("expected invalid attempt ledger error")
	}
	if err := os.WriteFile(seedLedgerPath(stateDir), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := loadSeedLedger(stateDir); err == nil {
		t.Fatal("expected invalid seed ledger error")
	}

	emptyDir := t.TempDir()
	if err := os.WriteFile(attemptLedgerPath(emptyDir), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	attempts, err := loadAttemptLedger(emptyDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(attempts.Attempts) != 0 {
		t.Fatalf("expected empty attempts, got %#v", attempts)
	}
	if err := os.WriteFile(seedLedgerPath(emptyDir), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	seeds, err := loadSeedLedger(emptyDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(seeds.Seeds) != 0 {
		t.Fatalf("expected empty seed ledger, got %#v", seeds)
	}
}

func TestTaskRunnerRunHappyPathDownloadsUploadsAndCompletes(t *testing.T) {
	payload := "happy path payload"
	var uploadedBody string
	uploadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		uploadedBody = string(body)
		w.Header().Set("ETag", `"etag-1"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer uploadServer.Close()

	ctx, cancel := context.WithCancel(context.Background())
	api := &happyPathAPI{
		task: clientHTTPTask("task-1", "assigned", "https://example.com/payload.bin", "payload.bin"),
		draft: client.ObjectDraft{
			ID:     "object-1",
			Name:   "payload.bin",
			Upload: &client.ObjectUploadInstructions{SessionID: "session-1", PartSize: int64(len(payload)), URLs: []string{uploadServer.URL}},
		},
		onCompleted: cancel,
	}
	registerHappyPathDownloader(t, payload)

	runner := NewTaskRunnerWithAPI(config.Config{
		Engine:             "http",
		DownloadDir:        t.TempDir(),
		PollInterval:       time.Millisecond,
		MaxConcurrentTasks: 1,
	}, api)
	runner.logger = slog.New(slog.NewTextHandler(io.Discard, nil))

	err := runner.Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if uploadedBody != payload {
		t.Fatalf("expected uploaded payload %q, got %q", payload, uploadedBody)
	}
	if !api.completed {
		t.Fatal("expected task to complete")
	}
	if api.completedObjectID != "object-1" {
		t.Fatalf("expected completed object id, got %q", api.completedObjectID)
	}
}

func TestNewTaskRunnerValidatesTokenAndBuildsClient(t *testing.T) {
	if _, err := NewTaskRunner(config.Config{}); err == nil {
		t.Fatal("expected missing token error")
	}
	runner, err := NewTaskRunner(config.Config{ServerURL: "https://zpan.example", Token: "token"})
	if err != nil {
		t.Fatal(err)
	}
	if runner.api == nil || runner.uploader == nil || runner.seeds == nil {
		t.Fatalf("expected runner dependencies to be initialized: %#v", runner)
	}
}

func TestTaskRunnerIntervalsAndControlBranches(t *testing.T) {
	runner := NewTaskRunnerWithAPI(config.Config{PollInterval: 123 * time.Millisecond, MaxConcurrentTasks: 1}, &recordingAPI{})
	runner.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	if runner.localPollInterval() != 123*time.Millisecond {
		t.Fatalf("expected configured local poll interval, got %s", runner.localPollInterval())
	}
	if got := NewTaskRunnerWithAPI(config.Config{}, &recordingAPI{}).localPollInterval(); got != 5*time.Second {
		t.Fatalf("expected default poll interval, got %s", got)
	}
	if got := runner.remotePollInterval(client.HeartbeatResult{NextPollAfterSeconds: 2}); got != 2*time.Second {
		t.Fatalf("expected remote interval, got %s", got)
	}

	task := clientTaskWithStatus("task-1", "suspended")
	runner.ackStoppedControlTask(context.Background(), task)
	runner.ackStoppedControlTask(context.Background(), clientTaskWithStatus("task-2", "pausing"))

	runner.cleanupDeletedTask(context.Background(), runner.logger, clientTaskWithStatus("task-1", "canceling"))
	errEngine := &recordingEngine{resetErr: errors.New("reset failed")}
	runner.downloader = NewManagerWithDownloader(errEngine)
	runner.cleanupDeletedTask(context.Background(), runner.logger, withRuntime(clientTaskWithStatus("task-3", "canceling"), &client.DownloadTaskRuntime{State: deleteRequestedRuntimeState}))

	_, ok := runner.startTask(context.Background(), "busy")
	if !ok {
		t.Fatal("expected first task to start")
	}
	if _, ok := runner.startTask(context.Background(), "busy"); ok {
		t.Fatal("expected duplicate task to be rejected")
	}
	if _, ok := runner.startTask(context.Background(), "other"); ok {
		t.Fatal("expected max concurrency to reject task")
	}
	runner.finish("busy")

	ackAPI := &recordingAPI{updateErr: errors.New("update failed")}
	ackRunner := NewTaskRunnerWithAPI(config.Config{}, ackAPI)
	ackRunner.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	ackRunner.ackStoppedControlTask(context.Background(), clientTaskWithStatus("task-4", "pausing"))
	ackRunner.ackStoppedControlTask(context.Background(), clientTaskWithStatus("task-5", "canceling"))
}

func TestTickAndResetErrorBranches(t *testing.T) {
	runner := NewTaskRunnerWithAPI(config.Config{MaxConcurrentTasks: 0}, &recordingAPI{
		assignedTasks: []client.DownloadTask{
			clientTaskWithStatus("missing-token", "assigned"),
			clientTaskWithUploadToken("busy", "assigned"),
		},
		nextPollAfterSeconds: 0,
	})
	runner.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	next, err := runner.tickAndNextPoll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if next != runner.localPollInterval() {
		t.Fatalf("expected local poll fallback, got %s", next)
	}

	runner = NewTaskRunnerWithAPI(config.Config{}, &recordingAPI{heartbeatErr: errors.New("heartbeat failed")})
	if _, err := runner.tickAndNextPoll(context.Background()); err == nil {
		t.Fatal("expected heartbeat error")
	}

	runner = NewTaskRunnerWithAPI(config.Config{}, &recordingAPI{})
	badAttempt := clientTaskWithStatus("bad", "assigned")
	badAttempt.Status.Attempt = 0
	if err := runner.resetTaskForAttempt(context.Background(), badAttempt, runner.logger); err == nil {
		t.Fatal("expected invalid attempt error")
	}
	task := clientTaskWithStatus("task-1", "assigned")
	runner.setMemoryAttempt(task.ID, task.Attempt())
	if err := runner.resetTaskForAttempt(context.Background(), task, runner.logger); err != nil {
		t.Fatal(err)
	}
	resetErr := errors.New("reset failed")
	runner.downloader = NewManagerWithDownloader(&recordingEngine{resetErr: resetErr})
	retry := clientTaskWithStatus("task-2", "assigned")
	retry.Status.Attempt = 2
	if err := runner.resetTaskForAttempt(context.Background(), retry, runner.logger); !errors.Is(err, resetErr) {
		t.Fatalf("expected reset error, got %v", err)
	}

	ids, ok := runner.localResultTaskIDs(context.Background())
	if !ok || len(ids) != 0 {
		t.Fatalf("expected empty local result ids, got %#v ok=%v", ids, ok)
	}
	runner = NewTaskRunnerWithAPI(config.Config{}, &recordingAPI{localResultErr: errors.New("list failed")})
	if _, ok := runner.localResultTaskIDs(context.Background()); ok {
		t.Fatal("expected local result list failure")
	}
}

func TestRegisterValidationAndReplacement(t *testing.T) {
	original := registeredDownloaders
	registeredDownloaders = nil
	t.Cleanup(func() { registeredDownloaders = original })

	mustPanic(t, func() {
		Register("", false, nil, func(Config) (Downloader, error) { return testDownloader{name: "x"}, nil })
	})
	mustPanic(t, func() {
		Register("bad", false, nil, nil)
	})

	Register("http", true, nil, func(Config) (Downloader, error) { return testDownloader{name: "old"}, nil })
	Register("http", true, nil, func(Config) (Downloader, error) { return testDownloader{name: "new"}, nil })
	entries := registrations()
	if len(entries) != 1 {
		t.Fatalf("expected replacement, got %#v", entries)
	}
	d, err := entries[0].new(Config{})
	if err != nil {
		t.Fatal(err)
	}
	if d.Name() != "new" {
		t.Fatalf("expected replacement constructor, got %q", d.Name())
	}
	if entries[0].configured(Config{}) {
		t.Fatal("expected nil configured callback to default false")
	}
}

func TestDirectoryUploadSuccessCreatesTree(t *testing.T) {
	var uploaded []string
	uploadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		uploaded = append(uploaded, string(body))
		w.Header().Set("ETag", `"etag"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer uploadServer.Close()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "disc"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "disc", "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	api := &recordingAPI{
		createFolderDrafts: []client.ObjectDraft{
			{ID: "root-id", Name: "album"},
			{ID: "sub-id", Name: "disc"},
		},
		createObjectDraft: client.ObjectDraft{
			ID:     "object-id",
			Name:   "file",
			Upload: &client.ObjectUploadInstructions{SessionID: "session", PartSize: 1, URLs: []string{uploadServer.URL}},
		},
	}
	uploader := NewUploader(api, nil)
	id, err := uploader.Upload(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), clientTaskWithUploadToken("task-1", "uploading"), Result{
		Path:  root,
		Name:  "album",
		Size:  2,
		IsDir: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != "root-id" {
		t.Fatalf("expected root id, got %q", id)
	}
	if !reflect.DeepEqual(uploaded, []string{"b", "a"}) {
		t.Fatalf("unexpected uploaded files: %#v", uploaded)
	}
	if len(api.deletedObjects) != 0 {
		t.Fatalf("did not expect cleanup after success, got %#v", api.deletedObjects)
	}
}

func TestCollectDirectoryEntriesSkipsHiddenTrees(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".hidden"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".hidden", "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".hidden-file"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "visible.txt"), []byte("visible"), 0o644); err != nil {
		t.Fatal(err)
	}
	entries, err := collectDirectoryEntries(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].name != "visible.txt" {
		t.Fatalf("expected only visible file, got %#v", entries)
	}
}

func TestUploadObjectSlicesTailPartAndMissingETag(t *testing.T) {
	var contentLengths []string
	var bodies []string
	uploadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		contentLengths = append(contentLengths, r.Header.Get("Content-Length"))
		bodies = append(bodies, string(body))
		if len(bodies) == 1 {
			w.Header().Set("ETag", `"etag-1"`)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer uploadServer.Close()

	path := writeTempFile(t, "hello")
	uploader := NewUploader(&recordingAPI{}, nil)
	err := uploader.uploadObjectSlices(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), clientTaskWithUploadToken("task-1", "uploading"), client.ObjectDraft{
		ID: "object-1",
		Upload: &client.ObjectUploadInstructions{
			SessionID: "session",
			PartSize:  3,
			URLs:      []string{uploadServer.URL, uploadServer.URL},
		},
	}, path, 5, &uploadProgress{totalBytes: 5, lastAt: time.Now()})
	if err == nil || !strings.Contains(err.Error(), "missing ETag") {
		t.Fatalf("expected missing etag on tail part, got %v", err)
	}
	if !reflect.DeepEqual(contentLengths, []string{"3", "2"}) || !reflect.DeepEqual(bodies, []string{"hel", "lo"}) {
		t.Fatalf("unexpected multipart reads: lengths=%v bodies=%v", contentLengths, bodies)
	}
}

func TestUploadProgressReaderReturnsProgressError(t *testing.T) {
	reader := &uploadProgressReader{
		reader: strings.NewReader("payload"),
		progress: func(int64) error {
			return errors.New("progress failed")
		},
	}
	buf := make([]byte, 3)
	n, err := reader.Read(buf)
	if n != 3 || err == nil || !strings.Contains(err.Error(), "progress failed") {
		t.Fatalf("expected progress error after read, n=%d err=%v", n, err)
	}
}

func TestUploadAndCompleteHandlesCanceledUploadStates(t *testing.T) {
	cases := []struct {
		name       string
		cancel     func(context.CancelCauseFunc)
		wantStatus string
		wantState  string
	}{
		{name: "paused", cancel: func(cancel context.CancelCauseFunc) { cancel(errTaskPausing) }, wantStatus: "paused"},
		{name: "canceled", cancel: func(cancel context.CancelCauseFunc) { cancel(errTaskCanceling) }, wantStatus: "canceled"},
		{name: "suspended", cancel: func(cancel context.CancelCauseFunc) { cancel(errTaskSuspended) }},
		{name: "interrupted", cancel: func(cancel context.CancelCauseFunc) { cancel(context.Canceled) }, wantStatus: "interrupted", wantState: "Interrupted because the downloader stopped"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			api := &recordingAPI{}
			runner := NewTaskRunnerWithAPI(config.Config{}, api)
			runner.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
			ctx, cancel := context.WithCancelCause(context.Background())
			tc.cancel(cancel)

			runner.uploadAndComplete(ctx, runner.logger, clientTaskWithUploadToken("task-1", "downloading"), Result{
				Path: writeTempFile(t, "payload"),
				Name: "payload.bin",
				Size: 7,
			}, nil)

			if tc.wantStatus == "" {
				if len(api.patches) != 0 {
					t.Fatalf("expected no status mutation, got %#v", api.patches)
				}
				return
			}
			last := api.patches[len(api.patches)-1]
			if last.State() != tc.wantStatus {
				t.Fatalf("expected status %q, got patch %#v", tc.wantStatus, last)
			}
			if tc.wantState != "" && (last.Runtime == nil || last.Runtime.Message != tc.wantState) {
				t.Fatalf("expected interrupted runtime, got %#v", last.Runtime)
			}
		})
	}
}

func TestUploadAndCompleteSuccessWithNilRuntimeCleansLocalFile(t *testing.T) {
	var uploaded string
	uploadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		uploaded = string(body)
		w.Header().Set("ETag", `"etag"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer uploadServer.Close()
	api := &recordingAPI{
		createObjectDraft: client.ObjectDraft{
			ID:     "object-1",
			Name:   "payload.bin",
			Upload: &client.ObjectUploadInstructions{SessionID: "session", PartSize: 1024, URLs: []string{uploadServer.URL}},
		},
	}
	runner := NewTaskRunnerWithAPI(config.Config{}, api)
	runner.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	path := writeTempFile(t, "payload")

	runner.uploadAndComplete(context.Background(), runner.logger, clientTaskWithUploadToken("task-1", "downloading"), Result{
		Path: path,
		Name: "payload.bin",
		Size: int64(len("payload")),
	}, nil)

	if uploaded != "payload" {
		t.Fatalf("expected upload body, got %q", uploaded)
	}
	last := api.patches[len(api.patches)-1]
	if last.State() != "completed" || last.Runtime == nil || last.Runtime.Phase != "completed" {
		t.Fatalf("expected completed patch, got %#v", last)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected local file cleanup, got %v", err)
	}
}

func TestSmallRuntimeHelpers(t *testing.T) {
	total := int64(10)
	detail := withDownloadRuntime(nil, 5, &total, 1)
	if detail == nil || detail.Progress == nil || detail.Progress.Download.Bytes != 5 {
		t.Fatalf("expected runtime progress, got %#v", detail)
	}
	bytes, gotTotal := downloadCheckpoint(detail)
	if bytes != 5 || gotTotal == nil || *gotTotal != total {
		t.Fatalf("unexpected checkpoint: %d %#v", bytes, gotTotal)
	}
	if optionalTime(time.Time{}) != nil {
		t.Fatal("expected zero time to map to nil")
	}
}

func TestSeedManagerFallbackAccessorsAndCleanupTask(t *testing.T) {
	manager := NewSeedManager(config.Config{}, &recordingAPI{}, nil, nil, nil, nil)
	if manager.log() == nil {
		t.Fatal("expected default logger")
	}
	if manager.manager() != nil {
		t.Fatal("expected nil manager")
	}

	cleaned := false
	manager.retainedSeeds = []retainedSeed{{
		taskID: "task-1",
		engine: "aria2",
		seedID: "seed-1",
		cleanup: func(context.Context) error {
			cleaned = true
			return nil
		},
	}}
	manager.CleanupTask(context.Background(), "task-1", "test")
	if !cleaned {
		t.Fatal("expected retained seed cleanup")
	}
	if len(manager.retainedSeedSnapshot()) != 0 {
		t.Fatalf("expected seed removed, got %#v", manager.retainedSeedSnapshot())
	}
}

func TestSeedManagerRestoreBranches(t *testing.T) {
	stateDir := t.TempDir()
	manager := NewTaskRunnerWithAPI(config.Config{SeedEnabled: true, StateDir: stateDir}, &recordingAPI{})
	manager.downloader = NewManagerWithDownloader(testDownloader{name: "http", sourceType: []string{"http"}})
	manager.seeds.Restore(context.Background())

	expiredPath := t.TempDir()
	if err := saveSeedLedger(stateDir, seedLedger{Seeds: []seedLedgerEntry{{
		TaskID:    "expired",
		Engine:    "aria2",
		SeedID:    "gid",
		Path:      expiredPath,
		ExpiresAt: time.Now().Add(-time.Second),
	}}}); err != nil {
		t.Fatal(err)
	}
	manager.seeds.Restore(context.Background())
	if _, err := os.Stat(expiredPath); !os.IsNotExist(err) {
		t.Fatalf("expected expired seed path removed, got %v", err)
	}

	existingPath := t.TempDir()
	if err := saveSeedLedger(stateDir, seedLedger{Seeds: []seedLedgerEntry{{
		TaskID:    "pending",
		Engine:    "aria2",
		SeedID:    "gid",
		Path:      existingPath,
		ExpiresAt: time.Now().Add(time.Hour),
	}}}); err != nil {
		t.Fatal(err)
	}
	engine := &recordingEngine{name: "aria2"}
	manager.downloader = NewManagerWithDownloader(engine)
	manager.seeds.Restore(context.Background())
	ledger, err := loadSeedLedger(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(ledger.Seeds) != 1 || ledger.Seeds[0].TaskID != "pending" {
		t.Fatalf("expected pending seed to be kept, got %#v", ledger.Seeds)
	}

	engine.restoreErr = errors.New("restore failed")
	manager.seeds.Restore(context.Background())
}

func TestSeedManagerReportAndReconcileBranches(t *testing.T) {
	api := &recordingAPI{localResultErr: errors.New("local result list failed")}
	runner := NewTaskRunnerWithAPI(config.Config{SeedEnabled: true}, api)
	runner.downloader = NewManagerWithDownloader(&recordingEngine{listSeedsErr: errors.New("list failed")})
	runner.seeds.Reconcile(context.Background())

	runner.downloader = NewManagerWithDownloader(testDownloader{name: "http", sourceType: []string{"http"}})
	runner.seeds.Reconcile(context.Background())

	runner.seeds.retainedSeeds = []retainedSeed{
		{
			taskID: "nil-runtime",
			engine: "aria2",
			seedID: "seed-1",
			size:   10,
			snapshot: func(context.Context) (SeedSnapshot, error) {
				return SeedSnapshot{}, nil
			},
			cleanup: func(context.Context) error { return nil },
		},
		{
			taskID: "snapshot-error",
			engine: "aria2",
			seedID: "seed-2",
			size:   10,
			snapshot: func(context.Context) (SeedSnapshot, error) {
				return SeedSnapshot{}, errors.New("temporary snapshot failure")
			},
			cleanup: func(context.Context) error { return nil },
		},
	}
	runner.seeds.Report(context.Background())
	runner.seeds.ReportStopped(context.Background())
}

type lifecycleDownloader struct {
	name        string
	sourceTypes []string
	startErr    error
	checkErr    error
	stopErr     error
	stopCalls   int
}

func (d *lifecycleDownloader) Name() string { return d.name }

func (d *lifecycleDownloader) Capabilities() Capabilities {
	return Capabilities{SourceTypes: d.sourceTypes}
}

func (d *lifecycleDownloader) Start(context.Context) error { return d.startErr }

func (d *lifecycleDownloader) Stop(context.Context) error {
	d.stopCalls++
	return d.stopErr
}

func (d *lifecycleDownloader) Check(context.Context) error { return d.checkErr }

func (d *lifecycleDownloader) InspectTask(context.Context, DownloadTask) (TaskSnapshot, bool, error) {
	return TaskSnapshot{}, false, nil
}

func (d *lifecycleDownloader) Download(context.Context, DownloadTask, ProgressReporter) (Result, error) {
	return Result{}, nil
}

func registerHappyPathDownloader(t *testing.T, payload string) {
	t.Helper()
	original := registeredDownloaders
	registeredDownloaders = nil
	Register("http", true, func(Config) bool { return true }, func(cfg Config) (Downloader, error) {
		return &happyPathDownloader{dir: cfg.DownloadDir, payload: payload}, nil
	})
	t.Cleanup(func() { registeredDownloaders = original })
}

type happyPathDownloader struct {
	dir     string
	payload string
}

func (d *happyPathDownloader) Name() string { return "http" }

func (d *happyPathDownloader) Capabilities() Capabilities {
	return Capabilities{SourceTypes: []string{"http"}}
}

func (d *happyPathDownloader) Start(context.Context) error { return nil }
func (d *happyPathDownloader) Stop(context.Context) error  { return nil }
func (d *happyPathDownloader) Check(context.Context) error { return nil }

func (d *happyPathDownloader) InspectTask(context.Context, DownloadTask) (TaskSnapshot, bool, error) {
	return TaskSnapshot{}, false, nil
}

func (d *happyPathDownloader) Download(_ context.Context, task DownloadTask, progress ProgressReporter) (Result, error) {
	taskDir := filepath.Join(d.dir, task.ID)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return Result{}, err
	}
	path := filepath.Join(taskDir, task.Name())
	if err := os.WriteFile(path, []byte(d.payload), 0o644); err != nil {
		return Result{}, err
	}
	size := int64(len(d.payload))
	if progress != nil {
		if err := progress(ProgressUpdate{Downloaded: size, Total: &size, Runtime: &TaskRuntime{Engine: "http", Phase: "downloading"}}); err != nil {
			return Result{}, err
		}
	}
	return Result{Path: path, Name: task.Name(), Size: size}, nil
}

type happyPathAPI struct {
	mu                sync.Mutex
	task              client.DownloadTask
	draft             client.ObjectDraft
	onCompleted       context.CancelFunc
	assigned          bool
	completed         bool
	completedObjectID string
}

func (a *happyPathAPI) Heartbeat(context.Context, client.Heartbeat) (client.HeartbeatResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.assigned {
		return client.HeartbeatResult{NextPollAfterSeconds: 1}, nil
	}
	a.assigned = true
	return client.HeartbeatResult{Assignments: []client.DownloadTask{a.task}, NextPollAfterSeconds: 1}, nil
}

func (a *happyPathAPI) AssignedTasks(context.Context) ([]client.DownloadTask, error) {
	return nil, nil
}

func (a *happyPathAPI) LocalResultTasks(context.Context) ([]client.DownloadTask, error) {
	return nil, nil
}

func (a *happyPathAPI) SeedingTasks(context.Context) ([]client.DownloadTask, error) {
	return nil, nil
}

func (a *happyPathAPI) UpdateTask(_ context.Context, id string, patch client.TaskPatch) (client.DownloadTask, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	task := a.task
	task.ID = id
	task = applyTaskPatch(task, patch)
	if patch.ResultObjectID != nil {
		a.completed = true
		a.completedObjectID = *patch.ResultObjectID
		if a.onCompleted != nil {
			a.onCompleted()
		}
	}
	a.task = task
	return task, nil
}

func (a *happyPathAPI) CreateFolder(context.Context, string, string, string) (client.ObjectDraft, error) {
	return client.ObjectDraft{}, errors.New("unexpected folder creation")
}

func (a *happyPathAPI) CreateObject(context.Context, string, string, int64, string) (client.ObjectDraft, error) {
	return a.draft, nil
}

func (a *happyPathAPI) CompleteObjectUpload(context.Context, string, string, string, []client.CompletedObjectUploadPart) error {
	return nil
}

func (a *happyPathAPI) AbortObjectUploadSession(context.Context, string, string, string) error {
	return nil
}

func (a *happyPathAPI) DeleteObject(context.Context, string, string) error {
	return nil
}

func ptrInt64(value int64) *int64 {
	return &value
}

func mustPanic(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	fn()
}
