package worker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/saltbo/zpan/downloader/internal/config"
	"github.com/saltbo/zpan/downloader/internal/engine"
)

func (w *Worker) resolveEngine(ctx context.Context) error {
	if w.cfg.Engine == "" || w.cfg.Engine == "auto" {
		return w.resolveAutoEngine(ctx)
	}
	downloader, err := configuredEngine(w.cfg)
	if err != nil {
		return err
	}
	w.logger.Info("checking configured downloader engine", "engine", downloader.Name())
	if w.checkEngine(ctx, downloader) == nil {
		w.useEngine(downloader, "configured engine is already running")
		return nil
	}
	if _, ok := downloader.(engine.Starter); !ok {
		w.useEngine(downloader, "configured built-in engine")
		return nil
	}
	if err := w.startEngine(ctx, downloader); err != nil {
		w.logger.Warn("configured downloader engine could not be started", "engine", downloader.Name(), "error", err)
		w.useEngine(downloader, "configured engine selected despite failed auto start")
		return nil
	}
	w.useEngine(downloader, "configured engine started")
	return nil
}

func (w *Worker) resolveAutoEngine(ctx context.Context) error {
	candidates := externalEngines(w.cfg)
	w.logger.Info("auto selecting downloader engine", "priority", engineNames(candidates))
	for _, downloader := range candidates {
		w.logger.Info("checking downloader engine availability", "engine", downloader.Name())
		if err := w.checkEngine(ctx, downloader); err == nil {
			w.useEngine(downloader, "engine is already running")
			return nil
		} else {
			w.logger.Info("downloader engine is not running", "engine", downloader.Name(), "error", err)
		}
	}
	for _, downloader := range candidates {
		w.logger.Info("checking downloader engine binary", "engine", downloader.Name())
		if err := w.startEngine(ctx, downloader); err != nil {
			w.logger.Info("downloader engine is not available for auto start", "engine", downloader.Name(), "error", err)
			continue
		}
		w.useEngine(downloader, "engine binary found and started")
		return nil
	}
	downloader := engine.HTTP{Dir: w.cfg.DownloadDir}
	w.useEngine(downloader, "no external downloader engine is running or installed")
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
	w.logger.Info("starting downloader engine", "engine", downloader.Name())
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

func configuredEngine(cfg config.Config) (engine.Engine, error) {
	for _, downloader := range append(externalEngines(cfg), engine.HTTP{Dir: cfg.DownloadDir}) {
		if downloader.Name() == cfg.Engine {
			return downloader, nil
		}
	}
	return nil, fmt.Errorf("unsupported downloader engine %q; expected auto, builtin, aria2, or qbittorrent", cfg.Engine)
}

func externalEngines(cfg config.Config) []engine.Engine {
	return []engine.Engine{
		engine.Aria2{URL: cfg.Aria2URL, Secret: cfg.Aria2Secret, Dir: cfg.DownloadDir, RetainSeed: cfg.SeedEnabled},
		engine.QBittorrent{URL: cfg.QBittorrentURL, Username: cfg.QBittorrentUser, Password: cfg.QBittorrentPass, Dir: cfg.DownloadDir, RetainSeed: cfg.SeedEnabled},
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

func engineNames(engines []engine.Engine) string {
	names := make([]string, 0, len(engines)+1)
	for _, downloader := range engines {
		names = append(names, downloader.Name())
	}
	names = append(names, "builtin")
	return strings.Join(names, ",")
}
