package worker

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/engine"
)

const retainedSeedReportInterval = 5 * time.Second

type retainedSeed struct {
	taskID     string
	engine     string
	seedID     string
	infoHash   string
	path       string
	size       int64
	downloaded int64
	uploadBase int64
	retainedAt time.Time
	expiresAt  time.Time
	snapshot   func(context.Context) (engine.SeedSnapshot, error)
	cleanup    func(context.Context) error
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
		infoHash:   strings.ToLower(result.Seed.InfoHash),
		path:       result.Seed.Path,
		size:       result.Size,
		downloaded: result.Size,
		retainedAt: now,
		snapshot:   result.Seed.Snapshot,
		cleanup:    result.Seed.Cleanup,
	}
	if w.cfg.SeedDuration > 0 {
		seed.expiresAt = now.Add(w.cfg.SeedDuration)
	}
	if snapshot, err := result.Seed.Snapshot(context.Background()); err == nil &&
		snapshot.Runtime != nil &&
		snapshot.Runtime.Seeding != nil &&
		snapshot.Runtime.Seeding.UploadedBytes != nil {
		seed.uploadBase = *snapshot.Runtime.Seeding.UploadedBytes
	} else if err != nil {
		log.Warn("failed to record retained bt seed upload baseline", "error", err)
	}
	w.mu.Lock()
	w.retainedSeeds = append(w.retainedSeeds, seed)
	count := len(w.retainedSeeds)
	w.mu.Unlock()
	if err := w.upsertSeedLedger(seed, result.Size); err != nil {
		log.Warn("failed to persist retained bt seed", "error", err)
	}

	log.Info("retaining completed bt task for seeding",
		"engine", seed.engine,
		"seed_id", seed.seedID,
		"path", seed.path,
		"expires_at", optionalTime(seed.expiresAt),
		"retained_seeds", count,
	)
	return true
}

func (w *Worker) restoreRetainedSeeds(ctx context.Context) {
	if !w.cfg.SeedEnabled || w.cfg.StateDir == "" {
		return
	}
	restorer, ok := w.engine.(engine.SeedRestorer)
	if !ok {
		return
	}
	ledger, err := loadSeedLedger(w.cfg.StateDir)
	if err != nil {
		w.logger.Warn("failed to load retained seed ledger", "error", err)
		return
	}
	if len(ledger.Seeds) == 0 {
		return
	}
	var restored []retainedSeed
	var kept []seedLedgerEntry
	now := time.Now()
	existing := map[string]struct{}{}
	for _, seed := range w.retainedSeedSnapshot() {
		existing[seed.taskID] = struct{}{}
	}
	for _, entry := range ledger.Seeds {
		if _, ok := existing[entry.TaskID]; ok {
			kept = append(kept, entry)
			continue
		}
		if !entry.ExpiresAt.IsZero() && !now.Before(entry.ExpiresAt) {
			_ = os.RemoveAll(entry.Path)
			continue
		}
		seed, err := restorer.RestoreSeed(ctx, engine.SeedRef{
			TaskID:   entry.TaskID,
			Engine:   entry.Engine,
			ID:       entry.SeedID,
			InfoHash: entry.InfoHash,
			Path:     entry.Path,
		})
		if err != nil {
			w.logger.Warn("failed to restore retained bt seed", "task_id", entry.TaskID, "engine", entry.Engine, "seed_id", entry.SeedID, "error", err)
			kept = append(kept, entry)
			continue
		}
		if seed == nil {
			if _, statErr := os.Stat(entry.Path); statErr == nil {
				w.logger.Debug("retained bt seed runtime is not ready; keeping local ledger entry", "task_id", entry.TaskID, "engine", entry.Engine, "path", entry.Path)
				kept = append(kept, entry)
			}
			continue
		}
		restored = append(restored, retainedSeed{
			taskID:     entry.TaskID,
			engine:     seed.Engine,
			seedID:     seed.ID,
			infoHash:   seed.InfoHash,
			path:       seed.Path,
			size:       entry.Size,
			downloaded: entry.Downloaded,
			uploadBase: entry.UploadBase,
			retainedAt: entry.RetainedAt,
			expiresAt:  entry.ExpiresAt,
			snapshot:   seed.Snapshot,
			cleanup:    seed.Cleanup,
		})
		entry.SeedID = seed.ID
		entry.InfoHash = strings.ToLower(seed.InfoHash)
		entry.Path = seed.Path
		kept = append(kept, entry)
	}
	if len(restored) > 0 {
		w.mu.Lock()
		w.retainedSeeds = append(w.retainedSeeds, restored...)
		count := len(w.retainedSeeds)
		w.mu.Unlock()
		w.logger.Info("restored retained bt seeds", "count", len(restored), "retained_seeds", count)
	}
	if err := saveSeedLedger(w.cfg.StateDir, seedLedger{Seeds: kept}); err != nil {
		w.logger.Warn("failed to save retained seed ledger", "error", err)
	}
}

func (w *Worker) reportRetainedSeeds(ctx context.Context) {
	for _, seed := range w.retainedSeedSnapshot() {
		log := w.logger.With("task_id", seed.taskID, "engine", seed.engine, "seed_id", seed.seedID)
		snapshot, err := seed.snapshot(ctx)
		if err != nil {
			if isMissingRetainedSeedError(err) {
				w.cleanupRetainedSeed(ctx, seed, "missing")
				continue
			}
			log.Warn("failed to inspect retained bt seed", "error", err)
			continue
		}
		if snapshot.Runtime == nil {
			continue
		}
		snapshot.Runtime.Phase = "seeding"
		snapshot.Runtime.ETASeconds = nil
		if snapshot.Runtime.Seeding == nil {
			snapshot.Runtime.Seeding = &client.DownloadTaskSeedingRuntime{}
		}
		active := true
		snapshot.Runtime.Seeding.Active = &active
		snapshot.Runtime.Progress = &client.DownloadTaskProgress{
			Download: *transferProgress(snapshot.Downloaded, snapshot.Total, 0),
			Upload:   *transferProgress(seed.size, &seed.size, 0),
		}
		_, err = w.updateTask(ctx, seed.taskID, client.TaskPatch{
			Progress: &client.DownloadTaskProgressPatch{
				Download: transferProgress(snapshot.Downloaded, snapshot.Total, 0),
				Upload:   transferProgress(seed.size, &seed.size, 0),
			},
			Runtime: snapshot.Runtime,
		})
		if err != nil {
			log.Warn("failed to report retained bt seed", "error", err)
			continue
		}
		log.Debug("reported retained bt seed", "downloaded_bytes", snapshot.Downloaded, "bps", snapshot.Bps)
	}
}

func (w *Worker) reportRetainedSeedsStopped(ctx context.Context) {
	seeds := w.retainedSeedSnapshot()
	if len(seeds) == 0 {
		return
	}
	reportCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for _, seed := range seeds {
		log := w.logger.With("task_id", seed.taskID, "engine", seed.engine, "seed_id", seed.seedID)
		runtime := &client.DownloadTaskRuntime{
			Engine: seed.engine,
			Phase:  "completed",
		}
		downloaded := seed.downloaded
		if downloaded <= 0 {
			downloaded = seed.size
		}
		total := seed.size
		if total <= 0 {
			total = downloaded
		}
		totalPtr := &total
		snapshot, err := seed.snapshot(reportCtx)
		if err != nil {
			if isMissingRetainedSeedError(err) {
				w.cleanupRetainedSeed(reportCtx, seed, "missing")
				continue
			}
			log.Warn("failed to inspect retained bt seed before shutdown", "error", err)
		} else {
			downloaded = snapshot.Downloaded
			if snapshot.Total != nil {
				totalPtr = snapshot.Total
			}
			if snapshot.Runtime != nil {
				runtime = snapshot.Runtime
			}
		}
		runtime.Phase = "completed"
		runtime.ETASeconds = nil
		if runtime.Seeding == nil {
			runtime.Seeding = &client.DownloadTaskSeedingRuntime{}
		}
		active := false
		zero := int64(0)
		runtime.Seeding.Active = &active
		runtime.Seeding.UploadBytesPerSecond = &zero
		runtime.Progress = &client.DownloadTaskProgress{
			Download: *transferProgress(downloaded, totalPtr, 0),
			Upload:   *transferProgress(seed.size, &seed.size, 0),
		}
		_, err = w.updateTask(reportCtx, seed.taskID, client.TaskPatch{
			Progress: &client.DownloadTaskProgressPatch{
				Download: transferProgress(downloaded, totalPtr, 0),
				Upload:   transferProgress(seed.size, &seed.size, 0),
			},
			Runtime: runtime,
		})
		if err != nil {
			log.Warn("failed to report retained bt seed stopped", "error", err)
		}
	}
}

func isMissingRetainedSeedError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "gid") && strings.Contains(message, "not found")
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
	if w.cfg.SeedRatio > 0 {
		for _, seed := range seeds {
			if reasons[seed.taskID] != "" || seed.downloaded <= 0 {
				continue
			}
			snapshot, err := seed.snapshot(ctx)
			if err != nil {
				w.logger.Warn("failed to inspect retained seed ratio", "task_id", seed.taskID, "path", seed.path, "error", err)
				continue
			}
			if snapshot.Runtime == nil ||
				snapshot.Runtime.Seeding == nil ||
				snapshot.Runtime.Seeding.UploadedBytes == nil {
				continue
			}
			uploaded := *snapshot.Runtime.Seeding.UploadedBytes - seed.uploadBase
			if uploaded >= int64(float64(seed.downloaded)*w.cfg.SeedRatio) {
				reasons[seed.taskID] = "ratio"
			}
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

func (w *Worker) runningTaskIDs() map[string]struct{} {
	w.mu.Lock()
	defer w.mu.Unlock()
	ids := make(map[string]struct{}, len(w.running))
	for id := range w.running {
		ids[id] = struct{}{}
	}
	return ids
}

// assignedSeedTaskIDs lists tasks the server still considers assigned to us and
// unfinished, so the seed reconciler won't adopt a download the task loop hasn't
// uploaded yet. A fetch error returns an empty set (reconcile as before).
func (w *Worker) assignedSeedTaskIDs(ctx context.Context) map[string]struct{} {
	ids := map[string]struct{}{}
	tasks, err := w.api.AssignedTasks(ctx)
	if err != nil {
		w.logger.Warn("failed to list assigned tasks for seed reconciliation", "error", err)
		return ids
	}
	for _, task := range tasks {
		ids[task.ID] = struct{}{}
	}
	return ids
}

// reconcileEngineSeeds adopts torrents the engine is still seeding but the
// worker no longer tracks (orphans left behind by restarts or ledger drift),
// so the normal time/ratio/cache cleanup applies to them instead of letting
// them seed forever and hold runtime slots. Tasks still mid-flight (running or
// already tracked) are skipped so reconciliation never races their cleanup.
func (w *Worker) reconcileEngineSeeds(ctx context.Context) {
	if !w.cfg.SeedEnabled {
		return
	}
	lister, ok := w.engine.(engine.SeedLister)
	if !ok {
		return
	}
	seeds, err := lister.ListSeeds(ctx)
	if err != nil {
		w.logger.Warn("failed to list engine seeds for reconciliation", "error", err)
		return
	}
	tracked := map[string]struct{}{}
	for _, seed := range w.retainedSeedSnapshot() {
		tracked[seed.taskID] = struct{}{}
	}
	running := w.runningTaskIDs()
	// Tasks still assigned to us (downloading/interrupted/uploading) are owned by
	// the task loop, which will upload then seed them. The reconciler runs at
	// startup before the loop marks them running, so without this an
	// auto-seeding-but-not-yet-uploaded torrent gets adopted as a done seed and
	// its upload is skipped (file lost when the seed expires).
	assigned := w.assignedSeedTaskIDs(ctx)
	now := time.Now()
	var adopted []retainedSeed
	for _, seed := range seeds {
		taskID := filepath.Base(seed.Path)
		if taskID == "" || taskID == "." || taskID == string(filepath.Separator) {
			continue
		}
		if _, ok := tracked[taskID]; ok {
			continue
		}
		if _, ok := running[taskID]; ok {
			continue
		}
		if _, ok := assigned[taskID]; ok {
			continue
		}
		size, err := directorySize(seed.Path)
		if err != nil {
			w.logger.Warn("failed to size adopted seed", "task_id", taskID, "path", seed.Path, "error", err)
			continue
		}
		adoptedSeed := retainedSeed{
			taskID:     taskID,
			engine:     seed.Engine,
			seedID:     seed.ID,
			infoHash:   strings.ToLower(seed.InfoHash),
			path:       seed.Path,
			size:       size,
			downloaded: size,
			retainedAt: now,
			snapshot:   seed.Snapshot,
			cleanup:    seed.Cleanup,
		}
		if w.cfg.SeedDuration > 0 {
			adoptedSeed.expiresAt = now.Add(w.cfg.SeedDuration)
		}
		adopted = append(adopted, adoptedSeed)
		tracked[taskID] = struct{}{}
		if err := w.upsertSeedLedger(adoptedSeed, size); err != nil {
			w.logger.Warn("failed to persist adopted seed", "task_id", taskID, "error", err)
		}
	}
	if len(adopted) == 0 {
		return
	}
	w.mu.Lock()
	w.retainedSeeds = append(w.retainedSeeds, adopted...)
	count := len(w.retainedSeeds)
	w.mu.Unlock()
	w.logger.Info("adopted untracked engine seeds for managed expiry", "count", len(adopted), "retained_seeds", count)
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
	if err := w.removeSeedLedger(seed.taskID); err != nil {
		w.logger.Warn("failed to remove retained seed ledger entry", "task_id", seed.taskID, "error", err)
	}
	// Tell the server the task is no longer seeding; otherwise its last runtime
	// report (phase=seeding) sticks and the UI shows it seeding forever.
	w.reportSeedingStopped(ctx, seed.taskID, seed.engine)
}

// reportSeedingStopped flips a completed task's runtime out of the seeding phase
// so the dashboard stops showing it as actively seeding. The task status stays
// completed; only the runtime phase/seeding flags change.
func (w *Worker) reportSeedingStopped(ctx context.Context, taskID string, engineName string) {
	if engineName == "" && w.engine != nil {
		engineName = w.engine.Name()
	}
	active := false
	zero := int64(0)
	if _, err := w.updateTask(ctx, taskID, client.TaskPatch{
		Runtime: &client.DownloadTaskRuntime{
			Engine: engineName,
			Phase:  "completed",
			Seeding: &client.DownloadTaskSeedingRuntime{
				Active:               &active,
				UploadBytesPerSecond: &zero,
			},
		},
	}); err != nil {
		w.logger.Warn("failed to report seeding stopped", "task_id", taskID, "error", err)
	}
}

// clearStaleSeedingReports runs once at startup: any task the server still
// reports as seeding but the worker is no longer tracking (a seed cleaned up
// before this fix shipped, or by a worker that never reported it stopped) gets
// a one-time stopped report so the dashboard clears it.
func (w *Worker) clearStaleSeedingReports(ctx context.Context) {
	tasks, err := w.api.SeedingTasks(ctx)
	if err != nil {
		w.logger.Warn("failed to list seeding tasks for reconciliation", "error", err)
		return
	}
	if len(tasks) == 0 {
		return
	}
	tracked := map[string]struct{}{}
	for _, seed := range w.retainedSeedSnapshot() {
		tracked[seed.taskID] = struct{}{}
	}
	cleared := 0
	for _, task := range tasks {
		if _, ok := tracked[task.ID]; ok {
			continue
		}
		w.reportSeedingStopped(ctx, task.ID, "")
		cleared++
	}
	if cleared > 0 {
		w.logger.Info("cleared stale seeding reports", "count", cleared)
	}
}

func (w *Worker) cleanupRetainedSeedForTask(ctx context.Context, taskID string, reason string) {
	for _, seed := range w.retainedSeedSnapshot() {
		if seed.taskID == taskID {
			w.cleanupRetainedSeed(ctx, seed, reason)
			break
		}
	}
	if err := w.removeSeedLedger(taskID); err != nil {
		w.logger.Warn("failed to remove retained seed ledger entry", "task_id", taskID, "error", err)
	}
}

func (w *Worker) upsertSeedLedger(seed retainedSeed, size int64) error {
	if w.cfg.StateDir == "" {
		return nil
	}
	ledger, err := loadSeedLedger(w.cfg.StateDir)
	if err != nil {
		return err
	}
	entry := seedLedgerEntry{
		TaskID:       seed.taskID,
		Engine:       seed.engine,
		SeedID:       seed.seedID,
		InfoHash:     strings.ToLower(seed.infoHash),
		Path:         seed.path,
		Size:         size,
		RetainedAt:   seed.retainedAt,
		ExpiresAt:    seed.expiresAt,
		Downloaded:   size,
		UploadBase:   seed.uploadBase,
		SeedDuration: w.cfg.SeedDuration.String(),
		SeedRatio:    w.cfg.SeedRatio,
	}
	replaced := false
	for i := range ledger.Seeds {
		if ledger.Seeds[i].TaskID == seed.taskID {
			ledger.Seeds[i] = entry
			replaced = true
			break
		}
	}
	if !replaced {
		ledger.Seeds = append(ledger.Seeds, entry)
	}
	return saveSeedLedger(w.cfg.StateDir, ledger)
}

func (w *Worker) removeSeedLedger(taskID string) error {
	if w.cfg.StateDir == "" {
		return nil
	}
	ledger, err := loadSeedLedger(w.cfg.StateDir)
	if err != nil {
		return err
	}
	next := ledger.Seeds[:0]
	for _, entry := range ledger.Seeds {
		if entry.TaskID != taskID {
			next = append(next, entry)
		}
	}
	ledger.Seeds = next
	return saveSeedLedger(w.cfg.StateDir, ledger)
}
