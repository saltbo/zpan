package worker

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/saltbo/zpan/internal/config"
	"github.com/saltbo/zpan/internal/engine"
)

func (w *Worker) resolveEngine(ctx context.Context) error {
	if w.cfg.Engine == "" || w.cfg.Engine == "auto" {
		if downloader, ok, err := explicitlyConfiguredExternalEngine(w.cfg, w.geoIP); err != nil {
			return err
		} else if ok {
			return w.useConfiguredExternalEngine(ctx, downloader)
		}
		return w.resolveAutoEngine(ctx)
	}
	downloader, err := configuredEngine(w.cfg, w.geoIP)
	if err != nil {
		return err
	}
	if downloader.Name() == "builtin" {
		w.useEngine(downloader, "configured built-in engine")
		return nil
	}
	return w.useConfiguredExternalEngine(ctx, downloader)
}

func (w *Worker) useConfiguredExternalEngine(ctx context.Context, downloader engine.Engine) error {
	w.logger.Info("checking configured downloader engine", "engine", downloader.Name())
	if err := w.checkEngine(ctx, downloader); err != nil {
		return fmt.Errorf("configured downloader engine %q is not available: %w", downloader.Name(), err)
	}
	w.useEngine(downloader, "configured external engine")
	return nil
}

func (w *Worker) resolveAutoEngine(ctx context.Context) error {
	candidates := externalEngines(w.cfg, w.geoIP)
	w.logger.Info("auto selecting downloader runtime", "priority", engineNames(candidates))
	for _, downloader := range candidates {
		w.logger.Info("checking downloader runtime binary", "engine", downloader.Name())
		if err := w.startEngine(ctx, downloader); err != nil {
			w.logger.Info("downloader runtime is not available for managed start", "engine", downloader.Name(), "error", err)
			continue
		}
		w.useEngine(downloader, "managed runtime binary found and started")
		return nil
	}
	downloader := engine.HTTP{Dir: w.cfg.DownloadDir}
	w.useEngine(downloader, "no external downloader runtime binary is installed")
	return nil
}

func (w *Worker) useEngine(downloader engine.Engine, reason string) {
	w.cfg.Engine = downloader.Name()
	w.engine = downloader
	w.logger.Info("selected downloader engine", "engine", downloader.Name(), "reason", reason)
}

func (w *Worker) checkEngine(ctx context.Context, downloader engine.Engine) error {
	checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return downloader.Check(checkCtx)
}

func (w *Worker) startEngine(ctx context.Context, downloader engine.Engine) error {
	starter, ok := downloader.(engine.Starter)
	if !ok {
		return fmt.Errorf("%s cannot be auto started", downloader.Name())
	}
	w.logger.Info("starting managed downloader runtime", "engine", downloader.Name())
	cmd, err := starter.Start(ctx)
	if err != nil {
		return err
	}
	if cmd.Process != nil {
		w.logger.Info("downloader engine process started", "engine", downloader.Name(), "pid", cmd.Process.Pid)
	}
	w.started = append(w.started, cmd)
	if err := waitForEngine(ctx, downloader); err != nil {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
		return err
	}
	go w.watchEngineProcess(downloader.Name(), cmd)
	return nil
}

// watchEngineProcess waits on a managed engine subprocess for the worker's
// lifetime. The engine is expected to outlive every task, so any exit we did
// not initiate is fatal: log it and cancel the run context, which makes Run
// return errEngineExited and the process exit non-zero so the supervisor
// restarts the whole downloader.
func (w *Worker) watchEngineProcess(name string, cmd *exec.Cmd) {
	err := cmd.Wait()
	if w.isStopping() {
		return
	}
	pid := 0
	if cmd.Process != nil {
		pid = cmd.Process.Pid
	}
	w.logger.Error("managed downloader engine exited unexpectedly", "engine", name, "pid", pid, "error", err)
	if w.cancelRun != nil {
		w.cancelRun(fmt.Errorf("%w: %s (pid %d): %v", errEngineExited, name, pid, err))
	}
}

func (w *Worker) stopStartedEngines() {
	w.markStopping()
	if len(w.started) > 0 {
		if saver, ok := w.engine.(engine.SessionSaver); ok {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := saver.SaveSession(ctx); err != nil {
				w.logger.Warn("failed to save downloader engine session", "engine", w.engine.Name(), "error", err)
			}
			cancel()
		}
	}
	for _, cmd := range w.started {
		if cmd.Process == nil {
			continue
		}
		w.logger.Info("stopping auto-started downloader engine", "pid", cmd.Process.Pid)
		_ = cmd.Process.Kill()
	}
}

func configuredEngine(cfg config.Config, geoIP engine.PeerGeoIPResolver) (engine.Engine, error) {
	for _, downloader := range append(externalEngines(cfg, geoIP), engine.HTTP{Dir: cfg.DownloadDir}) {
		if downloader.Name() == cfg.Engine {
			return downloader, nil
		}
	}
	return nil, fmt.Errorf("unsupported downloader engine %q; expected auto, builtin, aria2, or qbittorrent", cfg.Engine)
}

func explicitlyConfiguredExternalEngine(cfg config.Config, geoIP engine.PeerGeoIPResolver) (engine.Engine, bool, error) {
	configured := make([]engine.Engine, 0, 2)
	for _, downloader := range externalEngines(cfg, geoIP) {
		switch downloader.Name() {
		case "aria2":
			if cfg.Aria2Configured {
				configured = append(configured, downloader)
			}
		case "qbittorrent":
			if cfg.QBittorrentConfigured {
				configured = append(configured, downloader)
			}
		}
	}
	if len(configured) == 0 {
		return nil, false, nil
	}
	if len(configured) > 1 {
		return nil, false, fmt.Errorf("multiple external downloader engines are configured; set engine to aria2 or qbittorrent")
	}
	return configured[0], true, nil
}

func externalEngines(cfg config.Config, geoIP engine.PeerGeoIPResolver) []engine.Engine {
	return []engine.Engine{
		engine.Aria2{
			URL:                    cfg.Aria2URL,
			Secret:                 cfg.Aria2Secret,
			Dir:                    cfg.DownloadDir,
			StateDir:               cfg.StateDir,
			ListenPort:             cfg.BTListenPort,
			MaxConcurrentDownloads: aria2MaxConcurrentDownloads(cfg),
			RetainSeed:             cfg.SeedEnabled,
			SeedDuration:           cfg.SeedDuration,
			SeedRatio:              cfg.SeedRatio,
			GeoIP:                  geoIP,
		},
		engine.QBittorrent{URL: cfg.QBittorrentURL, Username: cfg.QBittorrentUser, Password: cfg.QBittorrentPass, Dir: cfg.DownloadDir, StateDir: cfg.StateDir, ListenPort: cfg.BTListenPort, RetainSeed: cfg.SeedEnabled, GeoIP: geoIP},
	}
}

// aria2MaxConcurrentDownloads keeps download and seeding concurrency separate.
// max_concurrent_tasks is the worker's download budget; retained seeds (which
// aria2 counts as active downloads) get their own budget on top so they never
// consume a download slot.
func aria2MaxConcurrentDownloads(cfg config.Config) int {
	limit := cfg.MaxConcurrentTasks
	if cfg.SeedEnabled {
		limit += cfg.SeedMaxConcurrent
	}
	return limit
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

func engineNames(engines []engine.Engine) string {
	names := make([]string, 0, len(engines)+1)
	for _, downloader := range engines {
		names = append(names, downloader.Name())
	}
	names = append(names, "builtin")
	return strings.Join(names, ",")
}
