package downloader

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
)

func TestCompletedUploadCleansSeedWhenLedgerCannotBeWritten(t *testing.T) {
	uploaded := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		uploaded = true
		w.Header().Set("ETag", `"etag"`)
	}))
	defer server.Close()
	api := &recordingAPI{createObjectDraft: client.ObjectDraft{
		ID: "object-1", Name: "payload.bin", Upload: testUploadInstructions("session", 7, server.URL),
	}}
	w := NewTaskRunnerWithAPI(config.Config{
		SeedEnabled: true, SeedDuration: time.Hour, StateDir: writeTempFile(t, "not a directory"),
	}, api)
	path := writeTempFile(t, "payload")
	w.uploadAndComplete(context.Background(), w.logger, clientTaskWithUploadToken("task-1", "downloading"), Result{
		Path: path, Name: "payload.bin", Size: 7,
		Seed: &Seed{Engine: "aria2", ID: "gid", Path: path,
			Snapshot: func(context.Context) (SeedSnapshot, error) { return SeedSnapshot{}, nil },
			Cleanup:  func(context.Context) error { return os.Remove(path) },
		},
	}, nil)
	lastPatchWithStatus(t, api.patches, "completed")
	if !uploaded {
		t.Fatal("must upload before deleting the local seed")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("unpersisted seed leaked after successful upload: %v", err)
	}
}

func TestCancellationRetriesCleanupBeforeAcknowledging(t *testing.T) {
	api := &recordingAPI{}
	task := clientTaskWithStatus("task-1", "canceling")
	payload := writeTempFile(t, "partial payload")
	cleanupErr := errors.New("engine unavailable")
	eng := &recordingEngine{resetTaskFn: func(ctx context.Context, _ DownloadTask) error {
		if err := ctx.Err(); err != nil {
			t.Fatalf("cleanup inherited canceled context: %v", err)
		}
		if cleanupErr != nil {
			return cleanupErr
		}
		return os.Remove(payload)
	}}
	w := NewTaskRunnerWithAPI(config.Config{}, api)
	w.downloader = NewManagerWithDownloader(eng)
	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errTaskCanceling)
	w.completeCancellation(ctx, w.logger, task)
	if len(api.patches) != 0 {
		t.Fatal("must not acknowledge cancellation while files remain")
	}
	cleanupErr = nil
	w.ackStoppedControlTask(context.Background(), task)
	patch := lastPatchWithStatus(t, api.patches, "canceled")
	if patch.Runtime == nil || patch.Runtime.State != localResultRemovedRuntimeState {
		t.Fatal("retry must redownload the removed local result")
	}
	if _, err := os.Stat(payload); !os.IsNotExist(err) {
		t.Fatalf("expected canceled payload removed: %v", err)
	}
}

func TestFailedDownloadCleanupPreservesBothFailureCauses(t *testing.T) {
	api := &recordingAPI{}
	w := NewTaskRunnerWithAPI(config.Config{}, api)
	w.downloader = NewManagerWithDownloader(&recordingEngine{
		downloadErr: errors.New("disk full"), resetErr: errors.New("cleanup failed"),
	})
	w.downloadThenUpload(context.Background(), w.logger, clientTaskWithStatus("task-1", "downloading"), nil)
	patch := lastPatchWithStatus(t, api.patches, "failed")
	if patch.ErrorMessage == nil || *patch.ErrorMessage != "disk full\ncleanup failed" {
		t.Fatalf("lost original or cleanup error: %#v", patch.ErrorMessage)
	}
	if patch.Runtime != nil && patch.Runtime.State == localResultRemovedRuntimeState {
		t.Fatal("failed cleanup must not report files removed")
	}
}

func TestConcurrentSeedRetentionSurvivesRestartAndExpiresFiles(t *testing.T) {
	stateDir := t.TempDir()
	filesDir := t.TempDir()
	cfg := config.Config{StateDir: stateDir, SeedEnabled: true, SeedDuration: time.Nanosecond}
	w := NewTaskRunnerWithAPI(cfg, &recordingAPI{})
	w.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	const count = 24
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < count; i++ {
		id := fmt.Sprintf("task-%d", i)
		path := filepath.Join(filesDir, id)
		if err := os.WriteFile(path, []byte("uploaded payload"), 0o644); err != nil {
			t.Fatal(err)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if !w.seeds.Retain(context.Background(), clientTask(id), Result{
				Path: path, Size: 16,
				Seed: &Seed{Engine: "aria2", ID: id, Path: path,
					Snapshot: func(context.Context) (SeedSnapshot, error) { return SeedSnapshot{}, nil },
					Cleanup:  func(context.Context) error { return os.Remove(path) },
				},
			}, w.logger) {
				t.Errorf("failed to persist %s", id)
			}
		}()
	}
	close(start)
	wg.Wait()
	ledger, err := loadSeedLedger(stateDir)
	if err != nil || len(ledger.Seeds) != count {
		t.Fatalf("lost concurrent seed records: count=%d err=%v", len(ledger.Seeds), err)
	}
	// A new runner has no engine sessions or in-memory seed state.
	restarted := NewTaskRunnerWithAPI(cfg, &recordingAPI{})
	restarted.seeds.Restore(context.Background())
	entries, err := os.ReadDir(filesDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("restart must clean every expired file: count=%d err=%v", len(entries), err)
	}
}
