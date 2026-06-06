package worker

import (
	"context"
	"log/slog"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/saltbo/zpan/cmd/internal/client"
	"github.com/saltbo/zpan/cmd/internal/engine"
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
			log.Warn("failed to inspect retained bt seed", "error", err)
			continue
		}
		if snapshot.Runtime == nil {
			continue
		}
		snapshot.Runtime.Phase = "seeding"
		if snapshot.Runtime.Seeding == nil {
			snapshot.Runtime.Seeding = &client.DownloadTaskSeedingRuntime{}
		}
		active := true
		snapshot.Runtime.Seeding.Active = &active
		_, err = w.updateTask(ctx, seed.taskID, client.TaskPatch{
			Progress: downloadProgressPatch(snapshot.Downloaded, snapshot.Total, 0),
			Runtime:  snapshot.Runtime,
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
