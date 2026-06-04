package worker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
	"github.com/saltbo/zpan/downloader/internal/config"
	"github.com/saltbo/zpan/downloader/internal/engine"
)

const Version = "0.1.0"
const maxTaskErrorMessageLength = 1000
const retainedSeedReportInterval = 5 * time.Second

var errBillingPaused = errors.New("billing paused")
var errTaskPausing = errors.New("task pausing")
var errTaskCanceling = errors.New("task canceling")

type Worker struct {
	cfg           config.Config
	api           *client.Client
	engine        engine.Engine
	logger        *slog.Logger
	running       map[string]context.CancelCauseFunc
	retainedSeeds []retainedSeed
	started       []*exec.Cmd
	mu            sync.Mutex
}

type retainedSeed struct {
	taskID     string
	engine     string
	seedID     string
	path       string
	retainedAt time.Time
	expiresAt  time.Time
	snapshot   func(context.Context) (engine.SeedSnapshot, error)
	cleanup    func(context.Context) error
}

func New(cfg config.Config) *Worker {
	return &Worker{
		cfg:     cfg,
		api:     client.New(cfg.ServerURL, cfg.Token),
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
		"poll_interval", w.cfg.PollInterval.String(),
		"max_concurrent_tasks", w.cfg.MaxConcurrentTasks,
		"seed_enabled", w.cfg.SeedEnabled,
		"seed_duration", w.cfg.SeedDuration.String(),
		"seed_cache_limit", w.cfg.SeedCacheLimit,
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
	if err := w.api.Heartbeat(ctx, w.heartbeat()); err != nil {
		return err
	}
	controlTasks, err := w.api.AssignedControlTasks(ctx)
	if err != nil {
		return err
	}
	for _, task := range controlTasks {
		w.cancelRunning(task)
	}
	tasks, err := w.api.AssignedTasks(ctx)
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
	if _, err := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "running"}); err != nil {
		log.Error("failed to mark task running", "error", err)
		if w.resolveControlledTaskUpdate(ctx, task.ID, err, log) {
			return
		}
	}

	var lastProgressLog time.Time
	currentDetail := task.Detail
	result, err := w.engine.Download(ctx, task, func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error {
		if detail != nil {
			currentDetail = detail
		}
		_, updateErr := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{
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
				if _, updateErr := w.api.UpdateTask(context.WithoutCancel(ctx), task.ID, client.TaskPatch{Status: "paused"}); updateErr != nil {
					log.Error("failed to mark task paused", "error", updateErr)
				}
				log.Info("task paused by control action")
				return
			}
			if errors.Is(context.Cause(ctx), errTaskCanceling) {
				if _, updateErr := w.api.UpdateTask(context.WithoutCancel(ctx), task.ID, client.TaskPatch{Status: "canceled"}); updateErr != nil {
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
		if _, updateErr := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}

	log.Debug("task download completed", "path", result.Path, "name", result.Name, "size", result.Size)
	if _, err := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "uploading"}); err != nil {
		log.Error("failed to mark task uploading", "error", err)
	}
	task.Detail = currentDetail
	resultObjectID, err := w.uploadResult(ctx, log, task, result)
	if err != nil {
		msg := taskErrorMessage(err)
		log.Error("failed to upload result", "error", err)
		if _, updateErr := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	zero := int64(0)
	uploadedBytes := result.Size
	completedDetail := task.Detail
	if completedDetail == nil {
		completedDetail = &client.DownloadTaskDetail{}
	}
	completedDetail.Phase = "completed"
	completedDetail.PeerUploadBps = nil
	if _, err := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{
		Status:               "completed",
		ResultObjectID:       &resultObjectID,
		StorageUploadedBytes: &uploadedBytes,
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

func cleanupDownloadedResult(ctx context.Context, result engine.Result) error {
	if result.Seed != nil && result.Seed.Cleanup != nil {
		return result.Seed.Cleanup(ctx)
	}
	return os.RemoveAll(result.Path)
}

func (w *Worker) retainSeed(task client.DownloadTask, result engine.Result, log *slog.Logger) bool {
	if !w.cfg.SeedEnabled || result.Seed == nil || result.Seed.Cleanup == nil || result.Seed.Snapshot == nil {
		return false
	}
	now := time.Now()
	seed := retainedSeed{
		taskID:     task.ID,
		engine:     result.Seed.Engine,
		seedID:     result.Seed.ID,
		path:       result.Seed.Path,
		retainedAt: now,
		snapshot:   result.Seed.Snapshot,
		cleanup:    result.Seed.Cleanup,
	}
	if w.cfg.SeedDuration > 0 {
		seed.expiresAt = now.Add(w.cfg.SeedDuration)
	}
	w.mu.Lock()
	w.retainedSeeds = append(w.retainedSeeds, seed)
	count := len(w.retainedSeeds)
	w.mu.Unlock()

	log.Info("retaining completed bt task for seeding",
		"engine", seed.engine,
		"seed_id", seed.seedID,
		"path", seed.path,
		"expires_at", optionalTime(seed.expiresAt),
		"retained_seeds", count,
	)
	return true
}

func (w *Worker) reportRetainedSeeds(ctx context.Context) {
	for _, seed := range w.retainedSeedSnapshot() {
		log := w.logger.With("task_id", seed.taskID, "engine", seed.engine, "seed_id", seed.seedID)
		snapshot, err := seed.snapshot(ctx)
		if err != nil {
			log.Warn("failed to inspect retained bt seed", "error", err)
			continue
		}
		if snapshot.Detail == nil {
			continue
		}
		snapshot.Detail.Phase = "seeding"
		zero := int64(0)
		_, err = w.api.UpdateTask(ctx, seed.taskID, client.TaskPatch{
			DownloadedBytes:  &snapshot.Downloaded,
			TotalBytes:       snapshot.Total,
			DownloadBps:      &snapshot.Bps,
			StorageUploadBps: &zero,
			Detail:           snapshot.Detail,
		})
		if err != nil {
			log.Warn("failed to report retained bt seed", "error", err)
			continue
		}
		log.Debug("reported retained bt seed", "downloaded_bytes", snapshot.Downloaded, "bps", snapshot.Bps)
	}
}

func (w *Worker) cleanupRetainedSeeds(ctx context.Context) {
	seeds := w.retainedSeedSnapshot()
	if len(seeds) == 0 {
		return
	}

	reasons := map[string]string{}
	now := time.Now()
	for _, seed := range seeds {
		if !seed.expiresAt.IsZero() && !now.Before(seed.expiresAt) {
			reasons[seed.taskID] = "expired"
		}
	}

	if w.cfg.SeedCacheLimit > 0 {
		type seedSize struct {
			seed retainedSeed
			size int64
		}
		sized := make([]seedSize, 0, len(seeds))
		var total int64
		for _, seed := range seeds {
			if reasons[seed.taskID] != "" {
				continue
			}
			size, err := directorySize(seed.path)
			if err != nil {
				w.logger.Warn("failed to inspect retained seed size", "task_id", seed.taskID, "path", seed.path, "error", err)
				continue
			}
			total += size
			sized = append(sized, seedSize{seed: seed, size: size})
		}
		sort.Slice(sized, func(i, j int) bool {
			return sized[i].seed.retainedAt.Before(sized[j].seed.retainedAt)
		})
		for _, item := range sized {
			if total <= w.cfg.SeedCacheLimit {
				break
			}
			reasons[item.seed.taskID] = "cache_limit"
			total -= item.size
		}
	}

	for _, seed := range seeds {
		reason := reasons[seed.taskID]
		if reason == "" {
			continue
		}
		w.cleanupRetainedSeed(ctx, seed, reason)
	}
}

func (w *Worker) retainedSeedSnapshot() []retainedSeed {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]retainedSeed(nil), w.retainedSeeds...)
}

func (w *Worker) cleanupRetainedSeed(ctx context.Context, seed retainedSeed, reason string) {
	w.logger.Info("cleaning retained bt seed",
		"task_id", seed.taskID,
		"engine", seed.engine,
		"seed_id", seed.seedID,
		"path", seed.path,
		"reason", reason,
	)
	if err := seed.cleanup(ctx); err != nil {
		w.logger.Warn("failed to clean retained bt seed",
			"task_id", seed.taskID,
			"engine", seed.engine,
			"seed_id", seed.seedID,
			"path", seed.path,
			"error", err,
		)
		return
	}
	w.mu.Lock()
	next := w.retainedSeeds[:0]
	for _, retained := range w.retainedSeeds {
		if retained.taskID != seed.taskID {
			next = append(next, retained)
		}
	}
	w.retainedSeeds = next
	w.mu.Unlock()
}

type uploadProgress struct {
	totalBytes int64
	uploaded   int64
	lastAt     time.Time
	lastBytes  int64
}

func (w *Worker) uploadResult(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	result engine.Result,
) (string, error) {
	if !result.IsDir {
		progress := &uploadProgress{totalBytes: result.Size, lastAt: time.Now()}
		return w.uploadSingleFile(ctx, log, task, result.Path, result.Name, result.Size, task.TargetFolder, progress)
	}

	progress := &uploadProgress{totalBytes: result.Size, lastAt: time.Now()}
	log.Info("creating remote folder", "name", result.Name, "size", result.Size, "target_folder", task.TargetFolder)
	root, err := w.api.CreateFolder(ctx, task.UploadToken, result.Name, task.TargetFolder)
	if err != nil {
		return "", fmt.Errorf("create remote folder: %w", err)
	}
	rootPath := joinObjectPath(task.TargetFolder, root.Name)
	entries, err := collectDirectoryEntries(result.Path)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		parent := joinObjectPath(rootPath, path.Dir(entry.relativePath))
		if entry.isDir {
			log.Debug("creating remote subfolder", "name", entry.name, "parent", parent)
			if _, err := w.api.CreateFolder(ctx, task.UploadToken, entry.name, parent); err != nil {
				return "", fmt.Errorf("create remote subfolder %s: %w", entry.relativePath, err)
			}
			continue
		}
		if _, err := w.uploadSingleFile(ctx, log, task, entry.path, entry.name, entry.size, parent, progress); err != nil {
			return "", err
		}
	}
	return root.ID, nil
}

func (w *Worker) uploadSingleFile(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	path string,
	name string,
	size int64,
	parent string,
	progress *uploadProgress,
) (string, error) {
	log.Info("creating remote object", "name", name, "size", size, "target_folder", parent)
	draft, err := w.api.CreateObject(ctx, task.UploadToken, name, size, parent)
	if err != nil {
		return "", fmt.Errorf("create remote object: %w", err)
	}
	log.Info("uploading file to object storage", "object_id", draft.ID, "path", path)
	if err := uploadFile(ctx, draft.UploadURL, path, draft.ContentDisposition, func(written int64) error {
		return w.reportUploadProgress(ctx, log, task, progress, written)
	}); err != nil {
		return "", fmt.Errorf("upload object %s: %w", draft.ID, err)
	}
	log.Info("confirming uploaded object", "object_id", draft.ID)
	if err := w.api.ConfirmObject(ctx, task.UploadToken, draft.ID); err != nil {
		return "", fmt.Errorf("confirm object %s: %w", draft.ID, err)
	}
	return draft.ID, nil
}

func (w *Worker) reportUploadProgress(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	progress *uploadProgress,
	written int64,
) error {
	progress.uploaded += written
	now := time.Now()
	if progress.uploaded < progress.totalBytes && now.Sub(progress.lastAt) < time.Second {
		return nil
	}
	elapsed := now.Sub(progress.lastAt).Seconds()
	var bps int64
	if elapsed > 0 {
		bps = int64(float64(progress.uploaded-progress.lastBytes) / elapsed)
	}
	detail := task.Detail
	if detail == nil {
		detail = &client.DownloadTaskDetail{}
	}
	detail.Phase = "uploading"
	detail.PeerUploadBps = nil
	_, err := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{
		Status:               "uploading",
		StorageUploadedBytes: &progress.uploaded,
		StorageUploadBps:     &bps,
		Detail:               detail,
	})
	if err != nil {
		log.Error("failed to report upload progress", "uploaded_bytes", progress.uploaded, "total_bytes", progress.totalBytes, "bps", bps, "error", err)
		return err
	}
	log.Debug("task upload progress", "uploaded_bytes", progress.uploaded, "total_bytes", progress.totalBytes, "bps", bps)
	progress.lastAt = now
	progress.lastBytes = progress.uploaded
	return nil
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

func (w *Worker) cancelRunning(task client.DownloadTask) {
	w.mu.Lock()
	cancel := w.running[task.ID]
	w.mu.Unlock()
	if cancel == nil {
		return
	}
	w.taskLogger(task).Info("canceling running task from server state", "status", task.Status)
	if task.Status == "pausing" {
		cancel(errTaskPausing)
		return
	}
	cancel(errTaskCanceling)
}

func (w *Worker) heartbeat() client.Heartbeat {
	hostname, _ := os.Hostname()
	return client.Heartbeat{
		Version:            Version,
		Hostname:           hostname,
		Platform:           runtime.GOOS,
		Arch:               runtime.GOARCH,
		Engine:             w.cfg.Engine,
		Capabilities:       capabilities(w.cfg.Engine),
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
		if _, updateErr := w.api.UpdateTask(ctx, taskID, client.TaskPatch{Status: "paused"}); updateErr != nil {
			log.Error("failed to mark task paused", "error", updateErr)
		}
		return true
	}
	if strings.Contains(message, "Task is canceling") {
		if _, updateErr := w.api.UpdateTask(ctx, taskID, client.TaskPatch{Status: "canceled"}); updateErr != nil {
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

type engineCandidate struct {
	name    string
	binary  []string
	engine  func(config.Config) engine.Engine
	start   func(context.Context, config.Config) (*exec.Cmd, error)
	canAuto bool
}

func (w *Worker) resolveEngine(ctx context.Context) error {
	if w.cfg.Engine == "" || w.cfg.Engine == "auto" {
		return w.resolveAutoEngine(ctx)
	}
	candidate, ok := engineCandidateByName(w.cfg.Engine)
	if !ok {
		return fmt.Errorf("unsupported downloader engine %q; expected auto, builtin, aria2, or qbittorrent", w.cfg.Engine)
	}
	w.logger.Info("checking configured downloader engine", "engine", candidate.name)
	if w.checkCandidate(ctx, candidate) == nil {
		w.useCandidate(candidate, "configured engine is already running")
		return nil
	}
	if !candidate.canAuto {
		w.useCandidate(candidate, "configured built-in engine")
		return nil
	}
	if err := w.startCandidate(ctx, candidate); err != nil {
		w.logger.Warn("configured downloader engine could not be started", "engine", candidate.name, "error", err)
		w.engine = candidate.engine(w.cfg)
		return nil
	}
	w.useCandidate(candidate, "configured engine started")
	return nil
}

func (w *Worker) resolveAutoEngine(ctx context.Context) error {
	candidates := externalEngineCandidates()
	w.logger.Info("auto selecting downloader engine", "priority", "aria2,qbittorrent,builtin")
	for _, candidate := range candidates {
		w.logger.Info("checking downloader engine availability", "engine", candidate.name)
		if err := w.checkCandidate(ctx, candidate); err == nil {
			w.useCandidate(candidate, "engine is already running")
			return nil
		} else {
			w.logger.Info("downloader engine is not running", "engine", candidate.name, "error", err)
		}
	}
	for _, candidate := range candidates {
		w.logger.Info("checking downloader engine binary", "engine", candidate.name, "binaries", strings.Join(candidate.binary, ","))
		if err := w.startCandidate(ctx, candidate); err != nil {
			w.logger.Info("downloader engine is not available for auto start", "engine", candidate.name, "error", err)
			continue
		}
		w.useCandidate(candidate, "engine binary found and started")
		return nil
	}
	w.cfg.Engine = "builtin"
	w.engine = engine.HTTP{Dir: w.cfg.DownloadDir}
	w.logger.Info("using built-in downloader engine", "reason", "no external downloader engine is running or installed")
	return nil
}

func (w *Worker) useCandidate(candidate engineCandidate, reason string) {
	w.cfg.Engine = candidate.name
	w.engine = candidate.engine(w.cfg)
	w.logger.Info("selected downloader engine", "engine", candidate.name, "reason", reason)
}

func (w *Worker) checkCandidate(ctx context.Context, candidate engineCandidate) error {
	checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return candidate.engine(w.cfg).Check(checkCtx)
}

func (w *Worker) startCandidate(ctx context.Context, candidate engineCandidate) error {
	if candidate.start == nil {
		return fmt.Errorf("%s cannot be auto started", candidate.name)
	}
	w.logger.Info("starting downloader engine", "engine", candidate.name)
	cmd, err := candidate.start(ctx, w.cfg)
	if err != nil {
		return err
	}
	if cmd.Process != nil {
		w.logger.Info("downloader engine process started", "engine", candidate.name, "pid", cmd.Process.Pid)
	}
	w.started = append(w.started, cmd)
	if err := waitForEngine(ctx, candidate.engine(w.cfg)); err != nil {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return err
	}
	return nil
}

func (w *Worker) stopStartedEngines() {
	for _, cmd := range w.started {
		if cmd.Process == nil {
			continue
		}
		w.logger.Info("stopping auto-started downloader engine", "pid", cmd.Process.Pid)
		_ = cmd.Process.Kill()
	}
}

func engineCandidateByName(name string) (engineCandidate, bool) {
	candidates := append(externalEngineCandidates(), builtinEngineCandidate())
	for _, candidate := range candidates {
		if candidate.name == name {
			return candidate, true
		}
	}
	return engineCandidate{}, false
}

func externalEngineCandidates() []engineCandidate {
	return []engineCandidate{
		{
			name:   "aria2",
			binary: []string{"aria2c"},
			engine: func(cfg config.Config) engine.Engine {
				return engine.Aria2{URL: cfg.Aria2URL, Secret: cfg.Aria2Secret, Dir: cfg.DownloadDir, RetainSeed: cfg.SeedEnabled}
			},
			start:   startAria2,
			canAuto: true,
		},
		{
			name:   "qbittorrent",
			binary: []string{"qbittorrent-nox", "qbittorrent"},
			engine: func(cfg config.Config) engine.Engine {
				return engine.QBittorrent{URL: cfg.QBittorrentURL, Username: cfg.QBittorrentUser, Password: cfg.QBittorrentPass, Dir: cfg.DownloadDir, RetainSeed: cfg.SeedEnabled}
			},
			start:   startQBittorrent,
			canAuto: true,
		},
	}
}

func builtinEngineCandidate() engineCandidate {
	return engineCandidate{
		name:   "builtin",
		engine: func(cfg config.Config) engine.Engine { return engine.HTTP{Dir: cfg.DownloadDir} },
	}
}

func selectEngine(cfg config.Config) engine.Engine {
	switch cfg.Engine {
	case "aria2":
		return engine.Aria2{URL: cfg.Aria2URL, Secret: cfg.Aria2Secret, Dir: cfg.DownloadDir, RetainSeed: cfg.SeedEnabled}
	case "qbittorrent":
		return engine.QBittorrent{
			URL:        cfg.QBittorrentURL,
			Username:   cfg.QBittorrentUser,
			Password:   cfg.QBittorrentPass,
			Dir:        cfg.DownloadDir,
			RetainSeed: cfg.SeedEnabled,
		}
	default:
		return engine.HTTP{Dir: cfg.DownloadDir}
	}
}

func waitForEngine(ctx context.Context, downloader engine.Engine) error {
	deadline := time.Now().Add(8 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		checkCtx, cancel := context.WithTimeout(ctx, time.Second)
		err := downloader.Check(checkCtx)
		cancel()
		if err == nil {
			return nil
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return lastErr
}

func startAria2(ctx context.Context, cfg config.Config) (*exec.Cmd, error) {
	path, err := exec.LookPath("aria2c")
	if err != nil {
		return nil, err
	}
	rpcURL, err := parseLocalEngineURL(cfg.Aria2URL, "6800")
	if err != nil {
		return nil, err
	}
	args := []string{
		"--enable-rpc=true",
		"--rpc-listen-all=false",
		"--rpc-listen-port=" + rpcURL.port,
		"--dir=" + cfg.DownloadDir,
		"--continue=true",
		"--allow-overwrite=true",
		"--auto-file-renaming=false",
	}
	if cfg.Aria2Secret != "" {
		args = append(args, "--rpc-secret="+cfg.Aria2Secret)
	}
	cmd := exec.CommandContext(ctx, path, args...)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	go func() { _ = cmd.Wait() }()
	return cmd, nil
}

func startQBittorrent(ctx context.Context, cfg config.Config) (*exec.Cmd, error) {
	path, err := lookPathAny("qbittorrent-nox", "qbittorrent")
	if err != nil {
		return nil, err
	}
	webURL, err := parseLocalEngineURL(cfg.QBittorrentURL, "8080")
	if err != nil {
		return nil, err
	}
	args := []string{}
	if strings.Contains(filepathBase(path), "qbittorrent-nox") {
		args = append(args, "--webui-port="+webURL.port)
	}
	cmd := exec.CommandContext(ctx, path, args...)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	go func() { _ = cmd.Wait() }()
	return cmd, nil
}

func lookPathAny(names ...string) (string, error) {
	var lastErr error
	for _, name := range names {
		path, err := exec.LookPath(name)
		if err == nil {
			return path, nil
		}
		lastErr = err
	}
	return "", lastErr
}

type localEngineURL struct {
	port string
}

func parseLocalEngineURL(raw string, defaultPort string) (localEngineURL, error) {
	normalized := raw
	if strings.HasPrefix(normalized, "ws://") {
		normalized = "http://" + strings.TrimPrefix(normalized, "ws://")
	}
	if strings.HasPrefix(normalized, "wss://") {
		normalized = "https://" + strings.TrimPrefix(normalized, "wss://")
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		return localEngineURL{}, err
	}
	host := parsed.Hostname()
	if host != "" && host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return localEngineURL{}, fmt.Errorf("auto start only supports local engine URLs, got %s", host)
	}
	port := parsed.Port()
	if port == "" {
		port = defaultPort
	}
	if _, err := strconv.Atoi(port); err != nil {
		return localEngineURL{}, fmt.Errorf("invalid engine port %q", port)
	}
	return localEngineURL{port: port}, nil
}

func filepathBase(path string) string {
	parts := strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return path
	}
	return parts[len(parts)-1]
}

func capabilities(name string) []string {
	switch name {
	case "aria2", "qbittorrent":
		return []string{"http", "magnet", "torrent"}
	default:
		return []string{"http"}
	}
}

func uploadFile(ctx context.Context, url, path string, contentDisposition string, progress func(written int64) error) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return err
	}
	reader := io.Reader(file)
	if progress != nil {
		reader = &uploadProgressReader{reader: file, progress: progress}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	if contentDisposition != "" {
		req.Header.Set("Content-Disposition", contentDisposition)
	}
	req.ContentLength = stat.Size()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		if len(body) > 0 {
			return fmt.Errorf("upload failed: %s: %s", res.Status, strings.TrimSpace(string(body)))
		}
		return fmt.Errorf("upload failed: %s", res.Status)
	}
	return nil
}

type uploadProgressReader struct {
	reader   io.Reader
	progress func(written int64) error
}

func (r *uploadProgressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		if progressErr := r.progress(int64(n)); progressErr != nil {
			return n, progressErr
		}
	}
	return n, err
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
