package downloader

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
	"github.com/saltbo/zpan/pkg/system"
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
	reportKey  string
	snapshot   func(context.Context) (SeedSnapshot, error)
	cleanup    func(context.Context) error
}

type SeedManager struct {
	cfg                config.Config
	api                apiClient
	logger             func() *slog.Logger
	downloader         func() *Manager
	runningTaskIDs     func() map[string]struct{}
	localResultTaskIDs func(context.Context) (map[string]struct{}, bool)
	retainedSeeds      []retainedSeed
	mu                 sync.Mutex
}

func NewSeedManager(
	cfg config.Config,
	api apiClient,
	logger func() *slog.Logger,
	downloader func() *Manager,
	runningTaskIDs func() map[string]struct{},
	localResultTaskIDs func(context.Context) (map[string]struct{}, bool),
) *SeedManager {
	return &SeedManager{
		cfg:                cfg,
		api:                api,
		logger:             logger,
		downloader:         downloader,
		runningTaskIDs:     runningTaskIDs,
		localResultTaskIDs: localResultTaskIDs,
	}
}

func (s *SeedManager) log() *slog.Logger {
	if s.logger == nil {
		return slog.Default()
	}
	logger := s.logger()
	if logger == nil {
		return slog.Default()
	}
	return logger
}

func (s *SeedManager) manager() *Manager {
	if s.downloader == nil {
		return nil
	}
	return s.downloader()
}

func (s *SeedManager) updateTask(ctx context.Context, id string, patch client.TaskPatch) (client.DownloadTask, error) {
	var task client.DownloadTask
	err := callAPI(ctx, s.log(), "update task", func(ctx context.Context) error {
		var err error
		task, err = s.api.UpdateTask(ctx, id, patch)
		return err
	})
	return task, err
}

func cleanupDownloadedResult(ctx context.Context, task client.DownloadTask, result Result) error {
	if result.Seed != nil && result.Seed.Cleanup != nil {
		return result.Seed.Cleanup(ctx)
	}
	parent := filepath.Dir(result.Path)
	if filepath.Base(parent) == task.ID {
		return os.RemoveAll(parent)
	}
	if result.IsDir {
		return os.RemoveAll(result.Path)
	}
	if err := os.Remove(result.Path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *SeedManager) Retain(ctx context.Context, task client.DownloadTask, result Result, log *slog.Logger) bool {
	if !s.cfg.SeedEnabled || result.Seed == nil || result.Seed.Cleanup == nil || result.Seed.Snapshot == nil {
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
	if s.cfg.SeedDuration > 0 {
		seed.expiresAt = now.Add(s.cfg.SeedDuration)
	}
	snapshotCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if snapshot, err := result.Seed.Snapshot(snapshotCtx); err == nil &&
		snapshot.Runtime != nil &&
		snapshot.Runtime.Seeding != nil &&
		snapshot.Runtime.Seeding.UploadedBytes != nil {
		seed.uploadBase = *snapshot.Runtime.Seeding.UploadedBytes
	} else if err != nil {
		log.Warn("failed to record retained bt seed upload baseline", "error", err)
	}
	s.mu.Lock()
	s.retainedSeeds = append(s.retainedSeeds, seed)
	count := len(s.retainedSeeds)
	s.mu.Unlock()
	if err := s.upsertSeedLedger(seed, result.Size); err != nil {
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

func (s *SeedManager) Restore(ctx context.Context) {
	if !s.cfg.SeedEnabled || s.cfg.StateDir == "" {
		return
	}
	ledger, err := loadSeedLedger(s.cfg.StateDir)
	if err != nil {
		s.log().Warn("failed to load retained seed ledger", "error", err)
		return
	}
	if len(ledger.Seeds) == 0 {
		return
	}
	var restored []retainedSeed
	var kept []seedLedgerEntry
	now := time.Now()
	existing := map[string]struct{}{}
	for _, seed := range s.retainedSeedSnapshot() {
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
		seed, supported, err := s.manager().RestoreSeed(ctx, SeedRef{
			TaskID:   entry.TaskID,
			Engine:   entry.Engine,
			ID:       entry.SeedID,
			InfoHash: entry.InfoHash,
			Path:     entry.Path,
		})
		if !supported {
			return
		}
		if err != nil {
			s.log().Warn("failed to restore retained bt seed", "task_id", entry.TaskID, "engine", entry.Engine, "seed_id", entry.SeedID, "error", err)
			kept = append(kept, entry)
			continue
		}
		if seed == nil {
			if _, statErr := os.Stat(entry.Path); statErr == nil {
				s.log().Debug("retained bt seed runtime is not ready; keeping local ledger entry", "task_id", entry.TaskID, "engine", entry.Engine, "path", entry.Path)
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
		s.mu.Lock()
		s.retainedSeeds = append(s.retainedSeeds, restored...)
		count := len(s.retainedSeeds)
		s.mu.Unlock()
		s.log().Info("restored retained bt seeds", "count", len(restored), "retained_seeds", count)
	}
	if err := saveSeedLedger(s.cfg.StateDir, seedLedger{Seeds: kept}); err != nil {
		s.log().Warn("failed to save retained seed ledger", "error", err)
	}
}

func (s *SeedManager) Report(ctx context.Context) {
	for _, seed := range s.retainedSeedSnapshot() {
		log := s.log().With("task_id", seed.taskID, "engine", seed.engine, "seed_id", seed.seedID)
		snapshot, err := seed.snapshot(ctx)
		if err != nil {
			if isMissingRetainedSeedError(err) {
				s.cleanupRetainedSeed(ctx, seed, "missing")
				continue
			}
			log.Warn("failed to inspect retained bt seed", "error", err)
			continue
		}
		runtime := zpanRuntime(snapshot.Runtime)
		if runtime == nil {
			continue
		}
		runtime.Phase = "seeding"
		runtime.ETASeconds = nil
		if runtime.Seeding == nil {
			runtime.Seeding = &client.DownloadTaskSeedingRuntime{}
		}
		active := true
		runtime.Seeding.Active = &active
		reportKey := retainedSeedReportKey(seed, snapshot, true)
		if reportKey == seed.reportKey {
			continue
		}
		runtime.Progress = &client.DownloadTaskProgress{
			Download: *transferProgress(snapshot.Downloaded, snapshot.Total, 0),
			Upload:   *transferProgress(seed.size, &seed.size, 0),
		}
		_, err = s.updateTask(ctx, seed.taskID, client.TaskPatch{
			Progress: &client.DownloadTaskProgressPatch{
				Download: transferProgress(snapshot.Downloaded, snapshot.Total, 0),
				Upload:   transferProgress(seed.size, &seed.size, 0),
			},
			Runtime: runtime,
		})
		if err != nil {
			log.Warn("failed to report retained bt seed", "error", err)
			continue
		}
		s.markRetainedSeedReported(seed.taskID, reportKey)
		log.Debug("reported retained bt seed", "downloaded_bytes", snapshot.Downloaded, "bps", snapshot.Bps)
	}
}

func (s *SeedManager) ReportStopped(ctx context.Context) {
	seeds := s.retainedSeedSnapshot()
	if len(seeds) == 0 {
		return
	}
	reportCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for _, seed := range seeds {
		log := s.log().With("task_id", seed.taskID, "engine", seed.engine, "seed_id", seed.seedID)
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
				s.cleanupRetainedSeed(reportCtx, seed, "missing")
				continue
			}
			log.Warn("failed to inspect retained bt seed before shutdown", "error", err)
		} else {
			downloaded = snapshot.Downloaded
			if snapshot.Total != nil {
				totalPtr = snapshot.Total
			}
			if converted := zpanRuntime(snapshot.Runtime); converted != nil {
				runtime = converted
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
		_, err = s.updateTask(reportCtx, seed.taskID, client.TaskPatch{
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

func (s *SeedManager) Cleanup(ctx context.Context) {
	seeds := s.retainedSeedSnapshot()
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
	if s.cfg.SeedRatio > 0 {
		for _, seed := range seeds {
			if reasons[seed.taskID] != "" || seed.downloaded <= 0 {
				continue
			}
			snapshot, err := seed.snapshot(ctx)
			if err != nil {
				s.log().Warn("failed to inspect retained seed ratio", "task_id", seed.taskID, "path", seed.path, "error", err)
				continue
			}
			if snapshot.Runtime == nil ||
				snapshot.Runtime.Seeding == nil ||
				snapshot.Runtime.Seeding.UploadedBytes == nil {
				continue
			}
			uploaded := *snapshot.Runtime.Seeding.UploadedBytes - seed.uploadBase
			if uploaded >= int64(float64(seed.downloaded)*s.cfg.SeedRatio) {
				reasons[seed.taskID] = "ratio"
			}
		}
	}

	if s.cfg.SeedCacheLimit > 0 {
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
			size, err := system.DirectorySize(seed.path)
			if err != nil {
				s.log().Warn("failed to inspect retained seed size", "task_id", seed.taskID, "path", seed.path, "error", err)
				continue
			}
			total += size
			sized = append(sized, seedSize{seed: seed, size: size})
		}
		sort.Slice(sized, func(i, j int) bool {
			return sized[i].seed.retainedAt.Before(sized[j].seed.retainedAt)
		})
		for _, item := range sized {
			if total <= s.cfg.SeedCacheLimit {
				break
			}
			reasons[item.seed.taskID] = "cache_limit"
			total -= item.size
		}
	}

	var protected map[string]struct{}
	var protectedOK bool
	for _, seed := range seeds {
		reason := reasons[seed.taskID]
		if reason == "" {
			continue
		}
		if protected == nil {
			protected, protectedOK = s.localResultTaskIDs(ctx)
		}
		if !protectedOK {
			s.log().Debug("skipping retained seed cleanup because task state is unavailable", "task_id", seed.taskID, "reason", reason)
			continue
		}
		if _, ok := protected[seed.taskID]; ok {
			s.log().Debug("skipping retained seed cleanup for incomplete task", "task_id", seed.taskID, "reason", reason)
			continue
		}
		s.cleanupRetainedSeed(ctx, seed, reason)
	}
}

func (s *SeedManager) retainedSeedSnapshot() []retainedSeed {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]retainedSeed(nil), s.retainedSeeds...)
}

func (s *SeedManager) markRetainedSeedReported(taskID string, reportKey string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.retainedSeeds {
		if s.retainedSeeds[i].taskID == taskID {
			s.retainedSeeds[i].reportKey = reportKey
			return
		}
	}
}

func retainedSeedReportKey(seed retainedSeed, snapshot SeedSnapshot, active bool) string {
	total := int64(-1)
	if snapshot.Total != nil {
		total = *snapshot.Total
	}
	uploaded := int64(-1)
	if snapshot.Runtime != nil && snapshot.Runtime.Seeding != nil && snapshot.Runtime.Seeding.UploadedBytes != nil {
		uploaded = *snapshot.Runtime.Seeding.UploadedBytes
	}
	return strings.Join([]string{
		strconv.FormatInt(snapshot.Downloaded, 10),
		strconv.FormatInt(total, 10),
		strconv.FormatInt(seed.size, 10),
		strconv.FormatInt(uploaded, 10),
		strconv.FormatBool(active),
	}, ":")
}

// reconcileEngineSeeds adopts torrents the engine is still seeding but the
// worker no longer tracks (orphans left behind by restarts or ledger drift),
// so the normal time/ratio/cache cleanup applies to them instead of letting
// them seed forever and hold runtime slots. Tasks still mid-flight (running or
// already tracked) are skipped so reconciliation never races their cleanup.
func (s *SeedManager) Reconcile(ctx context.Context) {
	if !s.cfg.SeedEnabled {
		return
	}
	seeds, supported, err := s.manager().ListSeeds(ctx)
	if !supported {
		return
	}
	if err != nil {
		s.log().Warn("failed to list engine seeds for reconciliation", "error", err)
		return
	}
	if len(seeds) == 0 {
		return
	}
	tracked := map[string]struct{}{}
	for _, seed := range s.retainedSeedSnapshot() {
		tracked[seed.taskID] = struct{}{}
	}
	running := s.runningTaskIDs()
	// Tasks still assigned to us (downloading/interrupted/uploading) are owned by
	// the task loop, which will upload then seed them. The reconciler runs at
	// startup before the loop marks them running, so without this an
	// auto-seeding-but-not-yet-uploaded torrent gets adopted as a done seed and
	// its upload is skipped (file lost when the seed expires).
	now := time.Now()
	candidates := make([]Seed, 0, len(seeds))
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
		candidates = append(candidates, seed)
	}
	if len(candidates) == 0 {
		return
	}
	protected, ok := s.localResultTaskIDs(ctx)
	if !ok {
		return
	}
	var adopted []retainedSeed
	for _, seed := range candidates {
		taskID := filepath.Base(seed.Path)
		if _, ok := protected[taskID]; ok {
			continue
		}
		size, err := system.DirectorySize(seed.Path)
		if err != nil {
			s.log().Warn("failed to size adopted seed", "task_id", taskID, "path", seed.Path, "error", err)
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
		if s.cfg.SeedDuration > 0 {
			adoptedSeed.expiresAt = now.Add(s.cfg.SeedDuration)
		}
		adopted = append(adopted, adoptedSeed)
		tracked[taskID] = struct{}{}
		if err := s.upsertSeedLedger(adoptedSeed, size); err != nil {
			s.log().Warn("failed to persist adopted seed", "task_id", taskID, "error", err)
		}
	}
	if len(adopted) == 0 {
		return
	}
	s.mu.Lock()
	s.retainedSeeds = append(s.retainedSeeds, adopted...)
	count := len(s.retainedSeeds)
	s.mu.Unlock()
	s.log().Info("adopted untracked engine seeds for managed expiry", "count", len(adopted), "retained_seeds", count)
}

func (s *SeedManager) cleanupRetainedSeed(ctx context.Context, seed retainedSeed, reason string) {
	s.log().Info("cleaning retained bt seed",
		"task_id", seed.taskID,
		"engine", seed.engine,
		"seed_id", seed.seedID,
		"path", seed.path,
		"reason", reason,
	)
	if err := seed.cleanup(ctx); err != nil {
		s.log().Warn("failed to clean retained bt seed",
			"task_id", seed.taskID,
			"engine", seed.engine,
			"seed_id", seed.seedID,
			"path", seed.path,
			"error", err,
		)
		return
	}
	s.mu.Lock()
	next := s.retainedSeeds[:0]
	for _, retained := range s.retainedSeeds {
		if retained.taskID != seed.taskID {
			next = append(next, retained)
		}
	}
	s.retainedSeeds = next
	s.mu.Unlock()
	if err := s.removeSeedLedger(seed.taskID); err != nil {
		s.log().Warn("failed to remove retained seed ledger entry", "task_id", seed.taskID, "error", err)
	}
	// Tell the server the task is no longer seeding; otherwise its last runtime
	// report (phase=seeding) sticks and the UI shows it seeding forever.
	s.reportSeedingStopped(ctx, seed.taskID, seed.engine)
}

// reportSeedingStopped flips a completed task's runtime out of the seeding phase
// so the dashboard stops showing it as actively seeding. The task status stays
// completed; only the runtime phase/seeding flags change.
func (s *SeedManager) reportSeedingStopped(ctx context.Context, taskID string, engineName string) {
	if engineName == "" && s.manager() != nil {
		engineName = s.manager().Name()
	}
	active := false
	zero := int64(0)
	if _, err := s.updateTask(ctx, taskID, client.TaskPatch{
		Runtime: &client.DownloadTaskRuntime{
			Engine: engineName,
			Phase:  "completed",
			Seeding: &client.DownloadTaskSeedingRuntime{
				Active:               &active,
				UploadBytesPerSecond: &zero,
			},
		},
	}); err != nil {
		s.log().Warn("failed to report seeding stopped", "task_id", taskID, "error", err)
	}
}

// clearStaleSeedingReports runs once at startup: any task the server still
// reports as seeding but the worker is no longer tracking (a seed cleaned up
// before this fix shipped, or by a worker that never reported it stopped) gets
// a one-time stopped report so the dashboard clears it.
func (s *SeedManager) ClearStaleReports(ctx context.Context) {
	tasks, err := s.api.SeedingTasks(ctx)
	if err != nil {
		s.log().Warn("failed to list seeding tasks for reconciliation", "error", err)
		return
	}
	if len(tasks) == 0 {
		return
	}
	tracked := map[string]struct{}{}
	for _, seed := range s.retainedSeedSnapshot() {
		tracked[seed.taskID] = struct{}{}
	}
	cleared := 0
	for _, task := range tasks {
		if _, ok := tracked[task.ID]; ok {
			continue
		}
		s.reportSeedingStopped(ctx, task.ID, "")
		cleared++
	}
	if cleared > 0 {
		s.log().Info("cleared stale seeding reports", "count", cleared)
	}
}

func (s *SeedManager) CleanupTask(ctx context.Context, taskID string, reason string) {
	for _, seed := range s.retainedSeedSnapshot() {
		if seed.taskID == taskID {
			s.cleanupRetainedSeed(ctx, seed, reason)
			break
		}
	}
	if err := s.removeSeedLedger(taskID); err != nil {
		s.log().Warn("failed to remove retained seed ledger entry", "task_id", taskID, "error", err)
	}
}

func (s *SeedManager) upsertSeedLedger(seed retainedSeed, size int64) error {
	if s.cfg.StateDir == "" {
		return nil
	}
	ledger, err := loadSeedLedger(s.cfg.StateDir)
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
		SeedDuration: s.cfg.SeedDuration.String(),
		SeedRatio:    s.cfg.SeedRatio,
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
	return saveSeedLedger(s.cfg.StateDir, ledger)
}

func (s *SeedManager) removeSeedLedger(taskID string) error {
	if s.cfg.StateDir == "" {
		return nil
	}
	ledger, err := loadSeedLedger(s.cfg.StateDir)
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
	return saveSeedLedger(s.cfg.StateDir, ledger)
}
