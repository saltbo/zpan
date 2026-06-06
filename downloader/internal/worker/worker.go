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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
	"github.com/saltbo/zpan/downloader/internal/config"
	"github.com/saltbo/zpan/downloader/internal/engine"
)

const Version = "0.1.0"
const maxTaskErrorMessageLength = 1000

var errBillingPaused = errors.New("billing paused")
var errTaskPausing = errors.New("task pausing")
var errTaskCanceling = errors.New("task canceling")

type taskResumeStage int

const (
	taskResumeDownload taskResumeStage = iota
	taskResumeUpload
)

type Worker struct {
	cfg           config.Config
	api           apiClient
	engine        engine.Engine
	logger        *slog.Logger
	running       map[string]context.CancelCauseFunc
	retainedSeeds []retainedSeed
	started       []*exec.Cmd
	mu            sync.Mutex
}

type apiClient interface {
	Heartbeat(context.Context, client.Heartbeat) error
	AssignedControlTasks(context.Context) ([]client.DownloadTask, error)
	AssignedTasks(context.Context) ([]client.DownloadTask, error)
	UpdateTask(context.Context, string, client.TaskPatch) (client.DownloadTask, error)
	CreateFolder(context.Context, string, string, string) (client.ObjectDraft, error)
	CreateObject(context.Context, string, string, int64, string) (client.ObjectDraft, error)
	ConfirmObject(context.Context, string, string) error
	CreateObjectUploadSession(context.Context, string, string, int64) (client.ObjectUploadSession, error)
	PresignObjectUploadParts(context.Context, string, string, string, []int) ([]client.PresignedObjectUploadPart, error)
	CompleteObjectUploadSession(context.Context, string, string, string, []client.CompletedObjectUploadPart) error
	AbortObjectUploadSession(context.Context, string, string, string) error
}

func New(cfg config.Config) (*Worker, error) {
	api, err := client.New(cfg.ServerURL, cfg.Token)
	if err != nil {
		return nil, err
	}
	return NewWithAPI(cfg, api), nil
}

func NewWithAPI(cfg config.Config, api apiClient) *Worker {
	return &Worker{
		cfg:     cfg,
		api:     api,
		logger:  slog.Default(),
		running: map[string]context.CancelCauseFunc{},
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
		"poll_interval", w.cfg.PollInterval.String(),
		"max_concurrent_tasks", w.cfg.MaxConcurrentTasks,
		"seed_enabled", w.cfg.SeedEnabled,
		"seed_duration", w.cfg.SeedDuration.String(),
		"seed_cache_limit", w.cfg.SeedCacheLimit,
		"seed_ratio", w.cfg.SeedRatio,
	)
	if err := w.resolveEngine(ctx); err != nil {
		return err
	}
	defer w.stopStartedEngines()

	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	w.logger.Info("checking downloader engine", "engine", w.cfg.Engine)
	if err := w.engine.Check(checkCtx); err != nil {
		w.logger.Error("downloader engine check failed", "engine", w.cfg.Engine, "error", err)
		return fmt.Errorf("engine %q is not available: %w", w.cfg.Engine, err)
	}
	w.logger.Info("downloader engine check passed", "engine", w.cfg.Engine)
	w.logger.Info("downloader started", "engine", w.cfg.Engine)
	w.restoreRetainedSeeds(ctx)
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()
	seedCleanupTicker := time.NewTicker(time.Minute)
	defer seedCleanupTicker.Stop()
	seedReportTicker := time.NewTicker(retainedSeedReportInterval)
	defer seedReportTicker.Stop()

	if err := w.tick(ctx); err != nil {
		w.logger.Error("downloader tick failed", "error", err)
	}
	for {
		select {
		case <-ctx.Done():
			w.logger.Info("downloader stopped", "reason", ctx.Err())
			return ctx.Err()
		case <-ticker.C:
			if err := w.tick(ctx); err != nil {
				w.logger.Error("downloader tick failed", "error", err)
			}
		case <-seedCleanupTicker.C:
			w.cleanupRetainedSeeds(ctx)
		case <-seedReportTicker.C:
			w.reportRetainedSeeds(ctx)
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
		if task.UploadToken == "" {
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
	log.Info("task started", "source_uri", task.SourceURI, "target_folder", task.TargetFolder)
	currentDetail := task.Detail
	if resumeStage(task) == taskResumeUpload {
		result, recovered, err := w.engine.Recover(ctx, task)
		if err != nil {
			msg := taskErrorMessage(err)
			log.Error("failed to recover completed download result", "error", err)
			if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
				log.Error("failed to mark task failed", "error", updateErr)
			}
			return
		}
		if recovered {
			log.Info("recovered completed download result", "path", result.Path, "name", result.Name, "size", result.Size)
			w.uploadAndComplete(ctx, log, task, result, currentDetail)
			return
		}
		log.Warn("task has no recoverable completed download result; restarting download", "status", task.Status)
	}

	if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "running"}); err != nil {
		log.Error("failed to mark task running", "error", err)
		if w.resolveControlledTaskUpdate(ctx, task.ID, err, log) {
			return
		}
	}

	var lastProgressLog time.Time
	result, err := w.engine.Download(ctx, task, func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error {
		detail = withDownloadETA(detail, downloaded, total, bps)
		if detail != nil {
			currentDetail = detail
		}
		_, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{
			DownloadedBytes: &downloaded,
			TotalBytes:      total,
			DownloadBps:     &bps,
			Detail:          detail,
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

func resumeStage(task client.DownloadTask) taskResumeStage {
	if task.Status == "uploading" {
		return taskResumeUpload
	}
	if task.Status != "assigned" && task.Status != "running" {
		return taskResumeDownload
	}
	if task.StorageUploadedBytes > 0 {
		return taskResumeUpload
	}
	if task.Detail != nil && (task.Detail.Phase == "uploading" || task.Detail.Phase == "completed") {
		return taskResumeUpload
	}
	if task.TotalBytes != nil && *task.TotalBytes > 0 && task.DownloadedBytes >= *task.TotalBytes {
		return taskResumeUpload
	}
	return taskResumeDownload
}

func (w *Worker) uploadAndComplete(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	result engine.Result,
	currentDetail *client.DownloadTaskDetail,
) {
	zero := int64(0)
	if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "uploading", DownloadBps: &zero}); err != nil {
		log.Error("failed to mark task uploading", "error", err)
	}
	task.Detail = currentDetail
	resultObjectID, err := w.uploadResult(ctx, log, task, result)
	if err != nil {
		msg := taskErrorMessage(err)
		log.Error("failed to upload result", "error", err)
		downloadedBytes := result.Size
		failedDetail := task.Detail
		if failedDetail == nil {
			failedDetail = &client.DownloadTaskDetail{}
		}
		failedDetail.Phase = "uploading"
		failedDetail.PeerUploadBps = nil
		if _, updateErr := w.updateTask(ctx, task.ID, client.TaskPatch{
			Status:           "failed",
			ErrorMessage:     &msg,
			DownloadedBytes:  &downloadedBytes,
			TotalBytes:       &downloadedBytes,
			DownloadBps:      &zero,
			StorageUploadBps: &zero,
			Detail:           failedDetail,
		}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	uploadedBytes := result.Size
	completedDetail := task.Detail
	if completedDetail == nil {
		completedDetail = &client.DownloadTaskDetail{}
	}
	completedDetail.Phase = "completed"
	completedDetail.PeerUploadBps = nil
	if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{
		Status:               "completed",
		ResultObjectID:       &resultObjectID,
		StorageUploadedBytes: &uploadedBytes,
		DownloadBps:          &zero,
		StorageUploadBps:     &zero,
		Detail:               completedDetail,
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

func withDownloadETA(detail *client.DownloadTaskDetail, downloaded int64, total *int64, bps int64) *client.DownloadTaskDetail {
	eta := downloadETA(downloaded, total, bps)
	if eta == nil {
		return detail
	}
	if detail == nil {
		return &client.DownloadTaskDetail{ETASeconds: eta}
	}
	if detail.ETASeconds == nil {
		detail.ETASeconds = eta
	}
	return detail
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

func multipartPartSize(size int64) int64 {
	partSize := int64(defaultMultipartPartSize)
	minPartSize := (size + maxMultipartParts - 1) / maxMultipartParts
	if minPartSize > partSize {
		partSize = minPartSize
		remainder := partSize % (1024 * 1024)
		if remainder != 0 {
			partSize += (1024 * 1024) - remainder
		}
	}
	if partSize > maxMultipartPartSize {
		return maxMultipartPartSize
	}
	return partSize
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
	return taskCtx, true
}

func (w *Worker) finish(taskID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.running, taskID)
}

func (w *Worker) cancelRunning(task client.DownloadTask) bool {
	w.mu.Lock()
	cancel := w.running[task.ID]
	w.mu.Unlock()
	if cancel == nil {
		return false
	}
	w.taskLogger(task).Info("canceling running task from server state", "status", task.Status)
	if task.Status == "pausing" {
		cancel(errTaskPausing)
		return true
	}
	cancel(errTaskCanceling)
	return true
}

func (w *Worker) ackStoppedControlTask(ctx context.Context, task client.DownloadTask) {
	log := w.taskLogger(task)
	if task.Status == "pausing" {
		if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "paused"}); err != nil {
			log.Error("failed to acknowledge paused task without local process", "error", err)
			return
		}
		log.Info("acknowledged paused task without local process")
		return
	}
	if task.Status == "canceling" {
		if _, err := w.updateTask(ctx, task.ID, client.TaskPatch{Status: "canceled"}); err != nil {
			log.Error("failed to acknowledge canceled task without local process", "error", err)
			return
		}
		log.Info("acknowledged canceled task without local process")
	}
}

func (w *Worker) heartbeat() client.Heartbeat {
	hostname, _ := os.Hostname()
	engineName := w.cfg.Engine
	capabilities := []string{"http"}
	if w.engine != nil {
		engineName = w.engine.Name()
		capabilities = w.engine.Capabilities()
	}
	return client.Heartbeat{
		Version:            Version,
		Hostname:           hostname,
		Platform:           runtime.GOOS,
		Arch:               runtime.GOARCH,
		Engine:             engineName,
		Capabilities:       capabilities,
		MaxConcurrentTasks: w.cfg.MaxConcurrentTasks,
		CurrentTasks:       w.currentTasks(),
		DownloadBps:        0,
		UploadBps:          0,
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
		"source_type", task.SourceType,
		"name", task.Name,
		"status", task.Status,
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
