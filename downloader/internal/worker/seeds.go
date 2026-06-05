package worker

import (
	"context"
	"log/slog"
	"os"
	"sort"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
	"github.com/saltbo/zpan/downloader/internal/engine"
)

const retainedSeedReportInterval = 5 * time.Second

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
		_, err = w.updateTask(ctx, seed.taskID, client.TaskPatch{
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
