package downloader

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"runtime"
	"runtime/debug"
	"sync"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
	"github.com/saltbo/zpan/pkg/geoip"
	"github.com/saltbo/zpan/pkg/system"
)

const Version = "0.1.0"
const maxTaskErrorMessageLength = 1000
const localResultRemovedRuntimeState = "local_result_removed"
const deleteRequestedRuntimeState = "delete_requested"

var errTaskPausing = errors.New("task pausing")
var errTaskCanceling = errors.New("task canceling")
var errTaskSuspended = errors.New("task suspended")
var errEngineExited = errors.New("managed downloader engine exited")

type taskWorkStage int

const (
	taskWorkStageDownload taskWorkStage = iota
	taskWorkStageUploadExistingResult
)

type TaskRunner struct {
	cfg        config.Config
	api        apiClient
	downloader *Manager
	uploader   *Uploader
	seeds      *SeedManager
	geoIP      *geoip.DB
	logger     *slog.Logger
	running    map[string]context.CancelCauseFunc
	speeds     map[string]transferSpeeds
	attempts   map[string]int
	wg         sync.WaitGroup
	mu         sync.Mutex
}

type transferSpeeds struct {
	downloadBps int64
	uploadBps   int64
}

type apiClient interface {
	Heartbeat(context.Context, client.Heartbeat) (client.HeartbeatResult, error)
	AssignedTasks(context.Context) ([]client.DownloadTask, error)
	LocalResultTasks(context.Context) ([]client.DownloadTask, error)
	SeedingTasks(context.Context) ([]client.DownloadTask, error)
	UpdateTask(context.Context, string, client.TaskPatch) (client.DownloadTask, error)
	CreateFolder(context.Context, string, string, string) (client.ObjectDraft, error)
	CreateObject(context.Context, string, string, int64, string) (client.ObjectDraft, error)
	CompleteObjectUpload(context.Context, string, string, string, []client.CompletedObjectUploadPart) error
	AbortObjectUploadSession(context.Context, string, string, string) error
	DeleteObject(context.Context, string, string) error
}

func NewTaskRunner(cfg config.Config) (*TaskRunner, error) {
	if cfg.Token == "" {
		return nil, errors.New("token is required")
	}
	api, err := client.New(cfg.ServerURL, cfg.Token)
	if err != nil {
		return nil, err
	}
	return NewTaskRunnerWithAPI(cfg, api), nil
}

func NewTaskRunnerWithAPI(cfg config.Config, api apiClient) *TaskRunner {
	runner := &TaskRunner{
		cfg:      cfg,
		api:      api,
		logger:   slog.Default(),
		running:  map[string]context.CancelCauseFunc{},
		speeds:   map[string]transferSpeeds{},
		attempts: map[string]int{},
	}
	runner.uploader = NewUploader(api, runner.setTaskTransferSpeed)
	runner.seeds = NewSeedManager(cfg, api, func() *slog.Logger { return runner.logger }, func() *Manager { return runner.downloader }, runner.runningTaskIDs, runner.localResultTaskIDs)
	return runner
}

func (w *TaskRunner) Run(ctx context.Context) error {
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
	geoIP, err := geoip.Open(w.cfg.GeoIPDBPath)
	if err != nil {
		return fmt.Errorf("open geoip database: %w", err)
	}
	w.geoIP = geoIP
	if w.geoIP != nil {
		w.logger.Info("geoip database loaded", "path", w.cfg.GeoIPDBPath)
		defer w.geoIP.Close()
	}
	// runCtx is cancelled either by the parent ctx (signal-driven shutdown) or
	// by the downloader manager when a managed subprocess dies. The latter
	// surfaces errEngineExited so the supervisor restarts this process.
	runCtx, cancelRun := context.WithCancelCause(ctx)
	defer cancelRun(nil)

	w.downloader = NewManager(w.cfg, w.geoIP, w.logger)
	if err := w.downloader.Start(runCtx, func(err error) {
		cancelRun(fmt.Errorf("%w: %v", errEngineExited, err))
	}); err != nil {
		return err
	}
	defer w.downloader.Stop(context.Background())

	w.logger.Info("downloader started", "engine", w.downloader.Name())
	w.seeds.Restore(runCtx)
	w.seeds.Reconcile(runCtx)
	w.seeds.ClearStaleReports(runCtx)
	pollTimer := time.NewTimer(0)
	defer pollTimer.Stop()
	seedCleanupTicker := time.NewTicker(time.Minute)
	defer seedCleanupTicker.Stop()
	seedReportTicker := time.NewTicker(retainedSeedReportInterval)
	defer seedReportTicker.Stop()

	for {
		select {
		case <-runCtx.Done():
			cause := context.Cause(runCtx)
			w.seeds.ReportStopped(context.WithoutCancel(runCtx))
			w.waitForTasks()
			if errors.Is(cause, errEngineExited) {
				// The downloader manager already logged the process exit.
				return cause
			}
			w.logger.Info("downloader stopped", "reason", cause)
			return nil
		case <-pollTimer.C:
			nextPoll, err := w.tickAndNextPoll(runCtx)
			if err != nil {
				w.logger.Error("downloader tick failed", "error", err)
				nextPoll = w.localPollInterval()
			}
			pollTimer.Reset(nextPoll)
		case <-seedCleanupTicker.C:
			w.seeds.Cleanup(runCtx)
		case <-seedReportTicker.C:
			w.seeds.Restore(runCtx)
			w.seeds.Reconcile(runCtx)
			w.seeds.Report(runCtx)
		}
	}
}

func (w *TaskRunner) tick(ctx context.Context) error {
	_, err := w.tickAndNextPoll(ctx)
	return err
}

func (w *TaskRunner) tickAndNextPoll(ctx context.Context) (time.Duration, error) {
	var heartbeat client.HeartbeatResult
	if err := callAPI(ctx, w.logger, "heartbeat", func(ctx context.Context) error {
		var err error
		heartbeat, err = w.api.Heartbeat(ctx, w.heartbeat())
		return err
	}); err != nil {
		return 0, err
	}
	for _, task := range heartbeat.Controls {
		if w.cancelRunning(task) {
			continue
		}
		w.ackStoppedControlTask(ctx, task)
	}
	w.logger.Debug("poll completed", "assigned_tasks", len(heartbeat.Assignments), "control_tasks", len(heartbeat.Controls), "running", w.currentTasks())
	for _, task := range heartbeat.Assignments {
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
	return w.remotePollInterval(heartbeat), nil
}

func (w *TaskRunner) updateTask(ctx context.Context, id string, patch client.TaskPatch) (client.DownloadTask, error) {
	var task client.DownloadTask
	err := callAPI(ctx, w.logger, "update task", func(ctx context.Context) error {
		var err error
		task, err = w.api.UpdateTask(ctx, id, patch)
		return err
	})
	return task, err
}

func (w *TaskRunner) remotePollInterval(heartbeat client.HeartbeatResult) time.Duration {
	if heartbeat.NextPollAfterSeconds <= 0 {
		return w.localPollInterval()
	}
	return time.Duration(heartbeat.NextPollAfterSeconds) * time.Second
}

func (w *TaskRunner) localPollInterval() time.Duration {
	if w.cfg.PollInterval > 0 {
		return w.cfg.PollInterval
	}
	return 5 * time.Second
}

func (w *TaskRunner) process(ctx context.Context, task client.DownloadTask) {
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

func (w *TaskRunner) downloadThenUpload(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	currentDetail *client.DownloadTaskRuntime,
) {
	// Marking the task downloading is also the credit gate: the server charges the
	// first unit on this transition and answers with the authoritative status. If
	// it comes back suspended, don't pull a single byte. (ProgressReporter reports below
	// stay pure telemetry — control still flows through the poll.)
	if updated, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "downloading"}); err != nil {
		log.Warn("failed to mark task downloading", "error", err)
	} else if updated.State() == "suspended" {
		log.Warn("task suspended before download started; insufficient credits")
		return
	}

	var lastProgressLog time.Time
	// ProgressReporter reporting is pure telemetry: it never decides whether to stop.
	// Control transitions (pause/cancel/suspend) arrive through the task poll
	// and cancel this context; a failed report just gets logged and retried.
	result, err := w.downloader.Download(ctx, downloadTask(task), func(update ProgressUpdate) error {
		downloaded := update.Downloaded
		total := update.Total
		bps := update.Bps
		detail := update.Runtime
		w.setTaskTransferSpeed(task.ID, transferSpeeds{downloadBps: bps})
		zpanDetail := withDownloadRuntime(zpanRuntime(detail), downloaded, total, bps)
		if zpanDetail != nil {
			currentDetail = zpanDetail
		}
		if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{
			Progress: downloadProgressPatch(downloaded, total, bps),
			Runtime:  zpanDetail,
		}); updateErr != nil {
			log.Warn("failed to report task progress", "downloaded_bytes", downloaded, "total_bytes", optionalInt64(total), "bps", bps, "error", updateErr)
		}
		if time.Since(lastProgressLog) >= 10*time.Second {
			log.Debug("task download progress", "downloaded_bytes", downloaded, "total_bytes", optionalInt64(total), "bps", bps)
			lastProgressLog = time.Now()
		}
		return nil
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
			if errors.Is(context.Cause(ctx), errTaskSuspended) {
				// The server already moved the task to suspended (billing); the
				// poll told us to stop. Don't touch its status.
				log.Info("task stopped because it was suspended")
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

func (w *TaskRunner) uploadExistingResult(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	currentDetail *client.DownloadTaskRuntime,
) {
	snapshot, found, err := w.downloader.InspectTask(ctx, downloadTask(task))
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
	if snapshot.State != TaskStateCompleted || snapshot.Result == nil {
		// The server checkpoint routed us here to upload an already-finished
		// download, but the engine isn't reporting it complete yet — e.g. aria2
		// is re-checking on-disk files after a restart, or the download was lost
		// and must resume. Fall back to the download path, which attaches/resumes
		// and uploads on completion, instead of failing the task.
		log.Info(
			"runtime not ready for direct upload; resuming via download path",
			"runtime_state", snapshot.State,
			"downloaded", snapshot.Downloaded,
			"total", optionalInt64(snapshot.Total),
			"has_result", snapshot.Result != nil,
		)
		w.downloadThenUpload(ctx, log, task, currentDetail)
		return
	}
	log.Info("using completed runtime result", "path", snapshot.Result.Path, "name", snapshot.Result.Name, "size", snapshot.Result.Size)
	w.uploadAndComplete(ctx, log, task, *snapshot.Result, currentDetail)
}

func (w *TaskRunner) recoverTaskPanic(ctx context.Context, taskID string, log *slog.Logger) {
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
	runtime := task.Runtime()
	if runtime != nil && runtime.State == localResultRemovedRuntimeState {
		return taskWorkStageDownload
	}
	if task.State() != "assigned" && task.State() != "downloading" && task.State() != "interrupted" {
		return taskWorkStageDownload
	}
	if task.Status.Progress.Upload.Bytes > 0 {
		return taskWorkStageUploadExistingResult
	}
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

func (w *TaskRunner) resetTaskForAttempt(ctx context.Context, task client.DownloadTask, log *slog.Logger) error {
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

func (w *TaskRunner) memoryAttempt(taskID string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.attempts[taskID]
}

func (w *TaskRunner) setMemoryAttempt(taskID string, attempt int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.attempts == nil {
		w.attempts = map[string]int{}
	}
	w.attempts[taskID] = attempt
}

func (w *TaskRunner) resetRuntimeTask(ctx context.Context, task client.DownloadTask, log *slog.Logger) error {
	w.seeds.CleanupTask(ctx, task.ID, "restart")
	log.Info("resetting downloader runtime task", "attempt", task.Attempt())
	if err := w.downloader.ResetTask(ctx, downloadTask(task)); err != nil {
		return fmt.Errorf("reset downloader runtime task: %w", err)
	}
	return nil
}

func (w *TaskRunner) cleanupDeletedTask(ctx context.Context, log *slog.Logger, task client.DownloadTask) {
	reason := "deleted"
	w.seeds.CleanupTask(ctx, task.ID, reason)
	if w.downloader == nil {
		log.Warn("downloader engine is unavailable for terminal cleanup", "reason", reason)
		return
	}
	if err := w.downloader.ResetTask(ctx, downloadTask(task)); err != nil {
		log.Warn("failed to clean terminal downloader task", "reason", reason, "error", err)
		return
	}
	log.Info("cleaned terminal downloader task", "reason", reason)
}

func (w *TaskRunner) uploadAndComplete(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	result Result,
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
	resultObjectID, err := w.uploader.Upload(ctx, log, task, result)
	if err != nil {
		downloadedBytes := result.Size
		if errors.Is(err, context.Canceled) {
			if errors.Is(context.Cause(ctx), errTaskPausing) {
				if _, updateErr := w.updateTask(context.WithoutCancel(ctx), task.ID, client.TaskPatch{Status: "paused"}); updateErr != nil {
					log.Error("failed to mark task paused during upload", "error", updateErr)
				}
				log.Info("task upload paused by control action")
				return
			}
			if errors.Is(context.Cause(ctx), errTaskCanceling) {
				if _, updateErr := w.updateTask(context.WithoutCancel(ctx), task.ID, client.TaskPatch{Status: "canceled"}); updateErr != nil {
					log.Error("failed to mark task canceled during upload", "error", updateErr)
				}
				log.Info("task upload canceled by control action")
				return
			}
			if errors.Is(context.Cause(ctx), errTaskSuspended) {
				log.Info("task upload stopped because it was suspended")
				return
			}
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
		if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{
			Status:       "failed",
			ErrorMessage: &msg,
			Progress: &client.DownloadTaskProgressPatch{
				Download: transferProgress(downloadedBytes, &downloadedBytes, zero),
				Upload:   transferProgress(0, &downloadedBytes, zero),
			},
			Runtime: currentDetail,
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
	if w.seeds.Retain(ctx, task, result, log) {
		w.seeds.Report(ctx)
		w.seeds.Cleanup(ctx)
		return
	}
	if err := cleanupDownloadedResult(ctx, task, result); err != nil {
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

func (w *TaskRunner) startTask(ctx context.Context, taskID string) (context.Context, bool) {
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

func (w *TaskRunner) finish(taskID string) {
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

func (w *TaskRunner) waitForTasks() {
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

func (w *TaskRunner) cancelRunning(task client.DownloadTask) bool {
	w.mu.Lock()
	cancel := w.running[task.ID]
	w.mu.Unlock()
	if cancel == nil {
		return false
	}
	w.taskLogger(task).Info("stopping running task from server state", "status", task.State())
	switch task.State() {
	case "pausing":
		cancel(errTaskPausing)
	case "suspended":
		cancel(errTaskSuspended)
	default:
		cancel(errTaskCanceling)
	}
	return true
}

func (w *TaskRunner) ackStoppedControlTask(ctx context.Context, task client.DownloadTask) {
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
		if runtime := task.Runtime(); runtime != nil && runtime.State == deleteRequestedRuntimeState {
			w.cleanupDeletedTask(ctx, log, task)
		}
		if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "canceled"}); err != nil {
			log.Error("failed to acknowledge canceled task without local process", "error", err)
			return
		}
		log.Info("acknowledged canceled task without local process")
		return
	}
	if task.State() == "suspended" {
		log.Debug("suspended task is stopped without local cleanup")
	}
}

func (w *TaskRunner) heartbeat() client.Heartbeat {
	engineName := w.cfg.Engine
	capabilities := []string{"http"}
	if w.downloader != nil {
		engineName = w.downloader.Name()
		capabilities = w.downloader.Capabilities()
	}
	speeds := w.currentTransferSpeeds()
	freeDiskBytes, err := system.FreeDiskBytes(w.cfg.DownloadDir)
	if err != nil {
		w.logger.Warn("failed to inspect downloader free disk space", "download_dir", w.cfg.DownloadDir, "error", err)
	}
	return client.Heartbeat{
		Version:            Version,
		Hostname:           system.DownloaderHostname(),
		Platform:           runtime.GOOS,
		Arch:               runtime.GOARCH,
		Engine:             engineName,
		Capabilities:       capabilities,
		MaxConcurrentTasks: w.cfg.MaxConcurrentTasks,
		CurrentTasks:       w.currentTasks(),
		DownloadBps:        speeds.downloadBps,
		UploadBps:          speeds.uploadBps,
		FreeDiskBytes:      freeDiskBytes,
	}
}

func (w *TaskRunner) currentTasks() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.running)
}

func (w *TaskRunner) runningTaskIDs() map[string]struct{} {
	w.mu.Lock()
	defer w.mu.Unlock()
	ids := make(map[string]struct{}, len(w.running))
	for id := range w.running {
		ids[id] = struct{}{}
	}
	return ids
}

// localResultTaskIDs lists tasks whose local completed download may still be
// needed by this downloader, so seed cleanup cannot delete it before retrying
// an upload failure or resuming a paused/suspended upload.
func (w *TaskRunner) localResultTaskIDs(ctx context.Context) (map[string]struct{}, bool) {
	ids := map[string]struct{}{}
	tasks, err := w.api.LocalResultTasks(ctx)
	if err != nil {
		w.logger.Warn("failed to list local-result tasks for seed reconciliation", "error", err)
		return ids, false
	}
	for _, task := range tasks {
		ids[task.ID] = struct{}{}
	}
	return ids, true
}

func (w *TaskRunner) setTaskTransferSpeed(taskID string, speeds transferSpeeds) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, exists := w.running[taskID]; !exists {
		return
	}
	w.speeds[taskID] = speeds
}

func (w *TaskRunner) currentTransferSpeeds() transferSpeeds {
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

func (w *TaskRunner) taskLogger(task client.DownloadTask) *slog.Logger {
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
