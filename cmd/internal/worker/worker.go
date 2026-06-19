package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
	"github.com/saltbo/zpan/internal/engine"
	"github.com/saltbo/zpan/internal/host"
)

const Version = "0.1.0"
const maxTaskErrorMessageLength = 1000

var errBillingPaused = errors.New("billing paused")
var errTaskPausing = errors.New("task pausing")
var errTaskCanceling = errors.New("task canceling")
var errEngineExited = errors.New("managed downloader engine exited")

type taskWorkStage int

const (
	taskWorkStageDownload taskWorkStage = iota
	taskWorkStageUploadExistingResult
)

type Worker struct {
	cfg           config.Config
	api           apiClient
	engine        engine.Engine
	geoIP         *engine.GeoIPResolver
	logger        *slog.Logger
	running       map[string]context.CancelCauseFunc
	speeds        map[string]transferSpeeds
	retainedSeeds []retainedSeed
	attempts      map[string]int
	started       []*exec.Cmd
	cancelRun     context.CancelCauseFunc
	stopping      bool
	wg            sync.WaitGroup
	mu            sync.Mutex
}

type transferSpeeds struct {
	downloadBps int64
	uploadBps   int64
}

type apiClient interface {
	Heartbeat(context.Context, client.Heartbeat) error
	AssignedControlTasks(context.Context) ([]client.DownloadTask, error)
	AssignedTasks(context.Context) ([]client.DownloadTask, error)
	UpdateTask(context.Context, string, client.TaskPatch) (client.DownloadTask, error)
	CreateFolder(context.Context, string, string, string) (client.ObjectDraft, error)
	CreateObject(context.Context, string, string, int64, string) (client.ObjectDraft, error)
	CompleteObjectUpload(context.Context, string, string, string, []client.CompletedObjectUploadPart) error
	AbortObjectUploadSession(context.Context, string, string, string) error
}

func New(cfg config.Config) (*Worker, error) {
	if cfg.Token == "" {
		return nil, errors.New("token is required")
	}
	api, err := client.New(cfg.ServerURL, cfg.Token)
	if err != nil {
		return nil, err
	}
	return NewWithAPI(cfg, api), nil
}

func NewWithAPI(cfg config.Config, api apiClient) *Worker {
	return &Worker{
		cfg:      cfg,
		api:      api,
		logger:   slog.Default(),
		running:  map[string]context.CancelCauseFunc{},
		speeds:   map[string]transferSpeeds{},
		attempts: map[string]int{},
	}
}

func (w *Worker) Run(ctx context.Context) error {
	if err := os.MkdirAll(w.cfg.DownloadDir, 0o755); err != nil {
		return err
	}
	w.logger.Info("downloader starting",
		"server_url", w.cfg.ServerURL,
		"engine", w.cfg.Engine,
		"download_dir", w.cfg.DownloadDir,
		"state_dir", w.cfg.StateDir,
		"geoip_db", w.cfg.GeoIPDBPath,
		"poll_interval", w.cfg.PollInterval.String(),
		"max_concurrent_tasks", w.cfg.MaxConcurrentTasks,
		"seed_enabled", w.cfg.SeedEnabled,
		"seed_duration", w.cfg.SeedDuration.String(),
		"seed_cache_limit", w.cfg.SeedCacheLimit,
		"seed_ratio", w.cfg.SeedRatio,
	)
	geoIP, err := engine.OpenGeoIPResolver(w.cfg.GeoIPDBPath)
	if err != nil {
		return fmt.Errorf("open geoip database: %w", err)
	}
	w.geoIP = geoIP
	if w.geoIP != nil {
		w.logger.Info("geoip database loaded", "path", w.cfg.GeoIPDBPath)
		defer w.geoIP.Close()
	}
	// runCtx is cancelled either by the parent ctx (signal-driven shutdown) or
	// by watchEngineProcess when a managed engine subprocess dies. The latter
	// surfaces errEngineExited as the cancel cause so Run returns a non-nil
	// error and the process exits non-zero for the supervisor to restart.
	runCtx, cancelRun := context.WithCancelCause(ctx)
	defer cancelRun(nil)
	w.cancelRun = cancelRun

	if err := w.resolveEngine(runCtx); err != nil {
		return err
	}
	defer w.stopStartedEngines()

	checkCtx, cancel := context.WithTimeout(runCtx, 10*time.Second)
	defer cancel()
	w.logger.Info("checking downloader engine", "engine", w.cfg.Engine)
	if err := w.engine.Check(checkCtx); err != nil {
		w.logger.Error("downloader engine check failed", "engine", w.cfg.Engine, "error", err)
		return fmt.Errorf("engine %q is not available: %w", w.cfg.Engine, err)
	}
	w.logger.Info("downloader engine check passed", "engine", w.cfg.Engine)
	w.logger.Info("downloader started", "engine", w.cfg.Engine)
	w.restoreRetainedSeeds(runCtx)
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()
	seedCleanupTicker := time.NewTicker(time.Minute)
	defer seedCleanupTicker.Stop()
	seedReportTicker := time.NewTicker(retainedSeedReportInterval)
	defer seedReportTicker.Stop()

	if err := w.tick(runCtx); err != nil {
		w.logger.Error("downloader tick failed", "error", err)
	}
	for {
		select {
		case <-runCtx.Done():
			cause := context.Cause(runCtx)
			w.reportRetainedSeedsStopped(context.WithoutCancel(runCtx))
			w.waitForTasks()
			if errors.Is(cause, errEngineExited) {
				// watchEngineProcess already logged the exit at error level.
				return cause
			}
			w.logger.Info("downloader stopped", "reason", cause)
			return nil
		case <-ticker.C:
			if err := w.tick(runCtx); err != nil {
				w.logger.Error("downloader tick failed", "error", err)
			}
		case <-seedCleanupTicker.C:
			w.cleanupRetainedSeeds(runCtx)
		case <-seedReportTicker.C:
			w.restoreRetainedSeeds(runCtx)
			w.reportRetainedSeeds(runCtx)
		}
	}
}

func (w *Worker) tick(ctx context.Context) error {
	if err := w.callAPI(ctx, "heartbeat", func(ctx context.Context) error {
		return w.api.Heartbeat(ctx, w.heartbeat())
	}); err != nil {
		return err
	}
	var controlTasks []client.DownloadTask
	err := w.callAPI(ctx, "assigned control tasks", func(ctx context.Context) error {
		var err error
		controlTasks, err = w.api.AssignedControlTasks(ctx)
		return err
	})
	if err != nil {
		return err
	}
	for _, task := range controlTasks {
		if w.cancelRunning(task) {
			continue
		}
		w.ackStoppedControlTask(ctx, task)
	}
	var tasks []client.DownloadTask
	err = w.callAPI(ctx, "assigned tasks", func(ctx context.Context) error {
		var err error
		tasks, err = w.api.AssignedTasks(ctx)
		return err
	})
	if err != nil {
		return err
	}
	w.logger.Debug("poll completed", "assigned_tasks", len(tasks), "running", w.currentTasks())
	for _, task := range tasks {
		taskLogger := w.taskLogger(task)
		if task.UploadToken() == "" {
			taskLogger.Warn("assigned task skipped because upload token is missing")
			continue
		}
		taskCtx, ok := w.startTask(ctx, task.ID)
		if !ok {
			taskLogger.Debug("assigned task skipped because worker is already busy")
			continue
		}
		go w.process(taskCtx, task)
	}
	return nil
}

func (w *Worker) process(ctx context.Context, task client.DownloadTask) {
	defer w.finish(task.ID)
	log := w.taskLogger(task)
	defer w.recoverTaskPanic(ctx, task.ID, log)
	log.Info("task started", "source_uri", task.SourceURI(), "target_folder", task.TargetFolder())
	if err := w.resetTaskForAttempt(ctx, task, log); err != nil {
		msg := taskErrorMessage(err)
		log.Error("failed to reset task for restart", "attempt", task.Attempt(), "error", err)
		if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	currentDetail := task.Runtime()
	if nextTaskWorkStage(task) == taskWorkStageUploadExistingResult {
		w.uploadExistingResult(ctx, log, task, currentDetail)
		return
	}

	w.downloadThenUpload(ctx, log, task, currentDetail)
}

func (w *Worker) downloadThenUpload(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	currentDetail *client.DownloadTaskRuntime,
) {
	if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "downloading"}); err != nil {
		log.Error("failed to mark task downloading", "error", err)
		if w.resolveControlledTaskUpdate(ctx, task.ID, err, log) {
			return
		}
	}

	var lastProgressLog time.Time
	result, err := w.engine.Download(ctx, task, func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskRuntime) error {
		w.setTaskTransferSpeed(task.ID, transferSpeeds{downloadBps: bps})
		detail = withDownloadRuntime(detail, downloaded, total, bps)
		if detail != nil {
			currentDetail = detail
		}
		_, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{
			Progress: downloadProgressPatch(downloaded, total, bps),
			Runtime:  detail,
		})
		if updateErr != nil && strings.Contains(updateErr.Error(), "insufficient_credits") {
			log.Warn("task paused by billing", "downloaded_bytes", downloaded, "total_bytes", optionalInt64(total), "bps", bps)
			return errBillingPaused
		}
		if updateErr != nil {
			log.Error("failed to report task progress", "downloaded_bytes", downloaded, "total_bytes", optionalInt64(total), "bps", bps, "error", updateErr)
			return updateErr
		}
		if time.Since(lastProgressLog) >= 10*time.Second {
			log.Debug("task download progress", "downloaded_bytes", downloaded, "total_bytes", optionalInt64(total), "bps", bps)
			lastProgressLog = time.Now()
		}
		return updateErr
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			if errors.Is(context.Cause(ctx), errTaskPausing) {
				if _, updateErr := w.updateTask(context.WithoutCancel(ctx), task.ID, client.TaskPatch{Status: "paused"}); updateErr != nil {
					log.Error("failed to mark task paused", "error", updateErr)
				}
				log.Info("task paused by control action")
				return
			}
			if errors.Is(context.Cause(ctx), errTaskCanceling) {
				if _, updateErr := w.updateTask(context.WithoutCancel(ctx), task.ID, client.TaskPatch{Status: "canceled"}); updateErr != nil {
					log.Error("failed to mark task canceled", "error", updateErr)
				}
				log.Info("task canceled by control action")
				return
			}
			zero := int64(0)
			downloaded, total := downloadCheckpoint(currentDetail)
			if _, updateErr := w.updateTask(context.WithoutCancel(ctx), task.ID, client.TaskPatch{
				Status:   "interrupted",
				Progress: downloadProgressPatch(downloaded, total, zero),
				Runtime:  interruptedRuntime(currentDetail),
			}); updateErr != nil {
				log.Error("failed to mark task interrupted after shutdown", "error", updateErr)
			}
			log.Info("task stopped by context cancellation")
			return
		}
		if isControlledTaskUpdateError(err) {
			if w.resolveControlledTaskUpdate(context.WithoutCancel(ctx), task.ID, err, log) {
				return
			}
			log.Info("task stopped because server state no longer accepts progress", "error", err)
			return
		}
		if errors.Is(err, errBillingPaused) {
			log.Warn("task stopped because credits are insufficient")
			return
		}
		msg := taskErrorMessage(err)
		log.Error("task download failed", "error", err)
		if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}

	log.Debug("task download completed", "path", result.Path, "name", result.Name, "size", result.Size)
	w.uploadAndComplete(ctx, log, task, result, currentDetail)
}

func (w *Worker) uploadExistingResult(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	currentDetail *client.DownloadTaskRuntime,
) {
	snapshot, found, err := w.engine.InspectTask(ctx, task)
	if err != nil {
		msg := taskErrorMessage(err)
		log.Error("failed to inspect downloader runtime task", "error", err)
		if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	if !found {
		msg := "download task is missing from downloader runtime"
		log.Error("failed to inspect downloader runtime task", "error", msg)
		if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	if snapshot.State != engine.TaskStateCompleted {
		panic(fmt.Errorf(
			"server task requires upload but runtime task is not completed: runtime_state=%s downloaded=%d total=%v",
			snapshot.State,
			snapshot.Downloaded,
			optionalInt64(snapshot.Total),
		))
	}
	if snapshot.Result == nil {
		panic("runtime reported completed task without a local result")
	}
	log.Info("using completed runtime result", "path", snapshot.Result.Path, "name", snapshot.Result.Name, "size", snapshot.Result.Size)
	w.uploadAndComplete(ctx, log, task, *snapshot.Result, currentDetail)
}

func (w *Worker) recoverTaskPanic(ctx context.Context, taskID string, log *slog.Logger) {
	value := recover()
	if value == nil {
		return
	}
	err := fmt.Errorf("panic: %v", value)
	msg := taskErrorMessage(err)
	log.Error("task panicked", "panic", value, "stack", string(debug.Stack()))
	if _, updateErr := w.updateTask(context.WithoutCancel(ctx), taskID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
		log.Error("failed to mark task failed after panic", "error", updateErr)
	}
}

func nextTaskWorkStage(task client.DownloadTask) taskWorkStage {
	if task.State() == "uploading" {
		return taskWorkStageUploadExistingResult
	}
	if task.State() != "assigned" && task.State() != "downloading" && task.State() != "interrupted" {
		return taskWorkStageDownload
	}
	if task.Status.Progress.Upload.Bytes > 0 {
		return taskWorkStageUploadExistingResult
	}
	runtime := task.Runtime()
	if runtime != nil && (runtime.Phase == "uploading" || runtime.Phase == "completed") {
		return taskWorkStageUploadExistingResult
	}
	if task.Status.Progress.Download.TotalBytes != nil &&
		*task.Status.Progress.Download.TotalBytes > 0 &&
		task.Status.Progress.Download.Bytes >= *task.Status.Progress.Download.TotalBytes {
		return taskWorkStageUploadExistingResult
	}
	return taskWorkStageDownload
}

func (w *Worker) resetTaskForAttempt(ctx context.Context, task client.DownloadTask, log *slog.Logger) error {
	attempt := task.Attempt()
	if attempt <= 0 {
		return fmt.Errorf("download task has invalid attempt %d", attempt)
	}
	if w.cfg.StateDir == "" {
		seen := w.memoryAttempt(task.ID)
		if seen == attempt {
			return nil
		}
		if attempt > 1 {
			if err := w.resetRuntimeTask(ctx, task, log); err != nil {
				return err
			}
		}
		w.setMemoryAttempt(task.ID, attempt)
		return nil
	}
	ledger, err := loadAttemptLedger(w.cfg.StateDir)
	if err != nil {
		return fmt.Errorf("load attempt ledger: %w", err)
	}
	seen := ledger.Attempts[task.ID]
	if seen == attempt {
		return nil
	}
	if attempt > 1 {
		if err := w.resetRuntimeTask(ctx, task, log); err != nil {
			return err
		}
	}
	ledger.Attempts[task.ID] = attempt
	if err := saveAttemptLedger(w.cfg.StateDir, ledger); err != nil {
		return fmt.Errorf("save attempt ledger: %w", err)
	}
	return nil
}

func (w *Worker) memoryAttempt(taskID string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.attempts[taskID]
}

func (w *Worker) setMemoryAttempt(taskID string, attempt int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.attempts == nil {
		w.attempts = map[string]int{}
	}
	w.attempts[taskID] = attempt
}

func (w *Worker) resetRuntimeTask(ctx context.Context, task client.DownloadTask, log *slog.Logger) error {
	resetter, ok := w.engine.(engine.TaskResetter)
	if !ok {
		return fmt.Errorf("engine %s does not support task reset", w.engine.Name())
	}
	w.cleanupRetainedSeedForTask(ctx, task.ID, "restart")
	log.Info("resetting downloader runtime task", "attempt", task.Attempt())
	if err := resetter.ResetTask(ctx, task); err != nil {
		return fmt.Errorf("reset downloader runtime task: %w", err)
	}
	return nil
}

func (w *Worker) uploadAndComplete(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	result engine.Result,
	currentDetail *client.DownloadTaskRuntime,
) {
	zero := int64(0)
	if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{
		Status:   "uploading",
		Progress: downloadProgressPatch(result.Size, &result.Size, zero),
	}); err != nil {
		log.Error("failed to mark task uploading", "error", err)
	}
	task.Status.Progress.Download = *transferProgress(result.Size, &result.Size, zero)
	task.Status.Progress.Upload = *transferProgress(0, &result.Size, zero)
	task.Status.Runtime = currentDetail
	resultObjectID, err := w.uploadResult(ctx, log, task, result)
	if err != nil {
		downloadedBytes := result.Size
		if errors.Is(err, context.Canceled) {
			uploadingDetail := currentDetail
			if uploadingDetail == nil {
				uploadingDetail = &client.DownloadTaskRuntime{}
			}
			uploadingDetail.Phase = "uploading"
			uploadingDetail.Seeding = nil
			if _, updateErr := w.updateTask(context.WithoutCancel(ctx), task.ID, client.TaskPatch{
				Status: "interrupted",
				Progress: &client.DownloadTaskProgressPatch{
					Download: transferProgress(downloadedBytes, &downloadedBytes, zero),
					Upload:   transferProgress(0, &downloadedBytes, zero),
				},
				Runtime: interruptedRuntime(uploadingDetail),
			}); updateErr != nil {
				log.Error("failed to mark task interrupted after upload shutdown", "error", updateErr)
			}
			log.Info("task upload stopped by context cancellation")
			return
		}
		msg := taskErrorMessage(err)
		log.Error("failed to upload result", "error", err)
		failedDetail := currentDetail
		if failedDetail == nil {
			failedDetail = &client.DownloadTaskRuntime{}
		}
		failedDetail.Phase = "uploading"
		failedDetail.Seeding = nil
		if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{
			Status:       "failed",
			ErrorMessage: &msg,
			Progress: &client.DownloadTaskProgressPatch{
				Download: transferProgress(downloadedBytes, &downloadedBytes, zero),
				Upload:   transferProgress(0, &downloadedBytes, zero),
			},
			Runtime: failedDetail,
		}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	uploadedBytes := result.Size
	completedDetail := currentDetail
	if completedDetail == nil {
		completedDetail = &client.DownloadTaskRuntime{}
	}
	completedDetail.Phase = "completed"
	completedDetail.ETASeconds = nil
	completedDetail.Seeding = nil
	if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{
		Status:         "completed",
		ResultObjectID: &resultObjectID,
		Progress: &client.DownloadTaskProgressPatch{
			Download: transferProgress(result.Size, &result.Size, zero),
			Upload:   transferProgress(uploadedBytes, &result.Size, zero),
		},
		Runtime: completedDetail,
	}); err != nil {
		log.Error("failed to mark task completed", "object_id", resultObjectID, "error", err)
		return
	}
	log.Debug("task completed", "object_id", resultObjectID)
	if w.retainSeed(task, result, log) {
		w.reportRetainedSeeds(ctx)
		w.cleanupRetainedSeeds(ctx)
		return
	}
	if err := cleanupDownloadedResult(ctx, result); err != nil {
		log.Warn("failed to remove local downloaded result", "path", result.Path, "error", err)
	}
}

func withDownloadRuntime(detail *client.DownloadTaskRuntime, downloaded int64, total *int64, bps int64) *client.DownloadTaskRuntime {
	if detail == nil {
		detail = &client.DownloadTaskRuntime{}
	}
	detail.Progress = &client.DownloadTaskProgress{
		Download: *transferProgress(downloaded, total, bps),
		Upload:   client.DownloadTaskTransferProgress{Bytes: 0, TotalBytes: nil, BytesPerSecond: 0},
	}
	eta := downloadETA(downloaded, total, bps)
	if eta == nil {
		return detail
	}
	if detail.ETASeconds == nil {
		detail.ETASeconds = eta
	}
	return detail
}

func interruptedRuntime(runtime *client.DownloadTaskRuntime) *client.DownloadTaskRuntime {
	if runtime == nil {
		runtime = &client.DownloadTaskRuntime{}
	}
	runtime.Message = "Interrupted because the downloader stopped"
	return runtime
}

func downloadProgressPatch(downloaded int64, total *int64, bps int64) *client.DownloadTaskProgressPatch {
	return &client.DownloadTaskProgressPatch{Download: transferProgress(downloaded, total, bps)}
}

func uploadProgressPatch(uploaded int64, total int64, bps int64) *client.DownloadTaskProgressPatch {
	return &client.DownloadTaskProgressPatch{Upload: transferProgress(uploaded, &total, bps)}
}

func transferProgress(bytes int64, total *int64, bps int64) *client.DownloadTaskTransferProgress {
	return &client.DownloadTaskTransferProgress{Bytes: bytes, TotalBytes: total, BytesPerSecond: bps}
}

func downloadCheckpoint(runtime *client.DownloadTaskRuntime) (int64, *int64) {
	if runtime == nil || runtime.Progress == nil {
		return 0, nil
	}
	return runtime.Progress.Download.Bytes, runtime.Progress.Download.TotalBytes
}

func downloadETA(downloaded int64, total *int64, bps int64) *int64 {
	if total == nil || *total <= 0 || downloaded >= *total || bps <= 0 {
		return nil
	}
	remaining := *total - downloaded
	eta := (remaining + bps - 1) / bps
	return &eta
}

func uploadETA(progress *uploadProgress, bps int64) *int64 {
	if progress == nil || progress.totalBytes <= 0 || progress.uploaded >= progress.totalBytes || bps <= 0 {
		return nil
	}
	remaining := progress.totalBytes - progress.uploaded
	eta := (remaining + bps - 1) / bps
	return &eta
}

type directoryEntry struct {
	path         string
	relativePath string
	name         string
	size         int64
	isDir        bool
}

func collectDirectoryEntries(root string) ([]directoryEntry, error) {
	var entries []directoryEntry
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		if strings.HasPrefix(entry.Name(), ".") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if !entry.IsDir() && isDownloadSidecarPath(relativePath) {
			return nil
		}
		item := directoryEntry{
			path:         path,
			relativePath: filepath.ToSlash(relativePath),
			name:         entry.Name(),
			isDir:        entry.IsDir(),
		}
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			item.size = info.Size()
		}
		entries = append(entries, item)
		return nil
	})
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].isDir != entries[j].isDir {
			return entries[i].isDir
		}
		return entries[i].relativePath < entries[j].relativePath
	})
	return entries, err
}

func isDownloadSidecarPath(path string) bool {
	base := filepath.Base(path)
	ext := filepath.Ext(base)
	return strings.HasPrefix(path, "[MEMORY]") ||
		strings.HasPrefix(path, "[METADATA]") ||
		strings.HasPrefix(base, "[MEMORY]") ||
		strings.HasPrefix(base, "[METADATA]") ||
		strings.EqualFold(ext, ".torrent") ||
		strings.EqualFold(ext, ".aria2")
}

func joinObjectPath(parent string, name string) string {
	name = strings.Trim(filepath.ToSlash(name), "/")
	if name == "" || name == "." {
		return strings.Trim(parent, "/")
	}
	parent = strings.Trim(parent, "/")
	if parent == "" {
		return name
	}
	return parent + "/" + name
}

func (w *Worker) startTask(ctx context.Context, taskID string) (context.Context, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, exists := w.running[taskID]; exists {
		return nil, false
	}
	if len(w.running) >= w.cfg.MaxConcurrentTasks {
		return nil, false
	}
	taskCtx, cancel := context.WithCancelCause(ctx)
	w.running[taskID] = cancel
	w.speeds[taskID] = transferSpeeds{}
	w.wg.Add(1)
	return taskCtx, true
}

func (w *Worker) finish(taskID string) {
	w.mu.Lock()
	_, exists := w.running[taskID]
	if exists {
		delete(w.running, taskID)
		delete(w.speeds, taskID)
	}
	w.mu.Unlock()
	if exists {
		w.wg.Done()
	}
}

// markStopping records that the worker is shutting down on purpose so
// watchEngineProcess can tell a deliberate engine kill from a crash.
func (w *Worker) markStopping() {
	w.mu.Lock()
	w.stopping = true
	w.mu.Unlock()
}

func (w *Worker) isStopping() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.stopping
}

func (w *Worker) waitForTasks() {
	done := make(chan struct{})
	go func() {
		w.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		w.logger.Warn("timed out waiting for running tasks to stop", "running", w.currentTasks())
	}
}

func (w *Worker) cancelRunning(task client.DownloadTask) bool {
	w.mu.Lock()
	cancel := w.running[task.ID]
	w.mu.Unlock()
	if cancel == nil {
		return false
	}
	w.taskLogger(task).Info("canceling running task from server state", "status", task.State())
	if task.State() == "pausing" {
		cancel(errTaskPausing)
		return true
	}
	cancel(errTaskCanceling)
	return true
}

func (w *Worker) ackStoppedControlTask(ctx context.Context, task client.DownloadTask) {
	log := w.taskLogger(task)
	if task.State() == "pausing" {
		if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "paused"}); err != nil {
			log.Error("failed to acknowledge paused task without local process", "error", err)
			return
		}
		log.Info("acknowledged paused task without local process")
		return
	}
	if task.State() == "canceling" {
		if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "canceled"}); err != nil {
			log.Error("failed to acknowledge canceled task without local process", "error", err)
			return
		}
		log.Info("acknowledged canceled task without local process")
	}
}

func (w *Worker) heartbeat() client.Heartbeat {
	engineName := w.cfg.Engine
	capabilities := []string{"http"}
	if w.engine != nil {
		engineName = w.engine.Name()
		capabilities = w.engine.Capabilities()
	}
	speeds := w.currentTransferSpeeds()
	return client.Heartbeat{
		Version:            Version,
		Hostname:           host.DownloaderHostname(),
		Platform:           runtime.GOOS,
		Arch:               runtime.GOARCH,
		Engine:             engineName,
		Capabilities:       capabilities,
		MaxConcurrentTasks: w.cfg.MaxConcurrentTasks,
		CurrentTasks:       w.currentTasks(),
		DownloadBps:        speeds.downloadBps,
		UploadBps:          speeds.uploadBps,
		FreeDiskBytes:      0,
	}
}

func (w *Worker) resolveControlledTaskUpdate(ctx context.Context, taskID string, err error, log *slog.Logger) bool {
	message := err.Error()
	if strings.Contains(message, "Task is pausing") {
		if _, updateErr := w.updateTask(ctx, taskID, client.TaskPatch{Status: "paused"}); updateErr != nil {
			log.Error("failed to mark task paused", "error", updateErr)
		}
		return true
	}
	if strings.Contains(message, "Task is canceling") {
		if _, updateErr := w.updateTask(ctx, taskID, client.TaskPatch{Status: "canceled"}); updateErr != nil {
			log.Error("failed to mark task canceled", "error", updateErr)
		}
		return true
	}
	return strings.Contains(message, "Task is paused") || strings.Contains(message, "Task is canceled")
}

func isControlledTaskUpdateError(err error) bool {
	message := err.Error()
	return strings.Contains(message, "Task is pausing") ||
		strings.Contains(message, "Task is paused") ||
		strings.Contains(message, "Task is canceling") ||
		strings.Contains(message, "Task is canceled")
}

func (w *Worker) currentTasks() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.running)
}

func (w *Worker) setTaskTransferSpeed(taskID string, speeds transferSpeeds) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, exists := w.running[taskID]; !exists {
		return
	}
	w.speeds[taskID] = speeds
}

func (w *Worker) currentTransferSpeeds() transferSpeeds {
	w.mu.Lock()
	defer w.mu.Unlock()
	var total transferSpeeds
	for _, speeds := range w.speeds {
		total.downloadBps += speeds.downloadBps
		total.uploadBps += speeds.uploadBps
	}
	return total
}

func taskErrorMessage(err error) string {
	msg := err.Error()
	if len(msg) <= maxTaskErrorMessageLength {
		return msg
	}
	return msg[:maxTaskErrorMessageLength-3] + "..."
}

func (w *Worker) taskLogger(task client.DownloadTask) *slog.Logger {
	return w.logger.With(
		"task_id", task.ID,
		"source_type", task.SourceType(),
		"name", task.Name(),
		"status", task.State(),
	)
}

func optionalInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func optionalTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value.Format(time.RFC3339)
}

func directorySize(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		total += info.Size()
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	return total, err
}
