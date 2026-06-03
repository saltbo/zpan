package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
	"github.com/saltbo/zpan/downloader/internal/config"
	"github.com/saltbo/zpan/downloader/internal/engine"
)

const Version = "0.1.0"

var errBillingPaused = errors.New("billing paused")

type Worker struct {
	cfg     config.Config
	api     *client.Client
	engine  engine.Engine
	logger  *slog.Logger
	running map[string]struct{}
	started []*exec.Cmd
	mu      sync.Mutex
}

func New(cfg config.Config) *Worker {
	return &Worker{
		cfg:     cfg,
		api:     client.New(cfg.ServerURL, cfg.Token),
		logger:  slog.Default(),
		running: map[string]struct{}{},
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
		}
	}
}

func (w *Worker) tick(ctx context.Context) error {
	if err := w.api.Heartbeat(ctx, w.heartbeat()); err != nil {
		return err
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
		if !w.canStart(task.ID) {
			taskLogger.Debug("assigned task skipped because worker is already busy")
			continue
		}
		go w.process(ctx, task)
	}
	return nil
}

func (w *Worker) process(ctx context.Context, task client.DownloadTask) {
	defer w.finish(task.ID)
	log := w.taskLogger(task)
	log.Info("task started", "source_uri", task.SourceURI, "target_folder", task.TargetFolder)
	if _, err := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "running"}); err != nil {
		log.Error("failed to mark task running", "error", err)
	}

	var lastProgressLog time.Time
	result, err := w.engine.Download(ctx, task, func(downloaded int64, total *int64, bps int64) error {
		_, updateErr := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{
			DownloadedBytes: &downloaded,
			TotalBytes:      total,
			DownloadBps:     &bps,
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
		if errors.Is(err, errBillingPaused) {
			log.Warn("task stopped because credits are insufficient")
			return
		}
		msg := err.Error()
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
	log.Info("creating remote object", "name", result.Name, "size", result.Size, "target_folder", task.TargetFolder)
	draft, err := w.api.CreateObject(ctx, task.UploadToken, result.Name, result.Size, task.TargetFolder)
	if err != nil {
		msg := err.Error()
		log.Error("failed to create remote object", "error", err)
		if _, updateErr := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	log.Info("uploading file to object storage", "object_id", draft.ID, "path", result.Path)
	if err := uploadFile(ctx, draft.UploadURL, result.Path); err != nil {
		msg := err.Error()
		log.Error("failed to upload file to object storage", "object_id", draft.ID, "error", err)
		if _, updateErr := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	log.Info("confirming uploaded object", "object_id", draft.ID)
	if err := w.api.ConfirmObject(ctx, task.UploadToken, draft.ID); err != nil {
		msg := err.Error()
		log.Error("failed to confirm uploaded object", "object_id", draft.ID, "error", err)
		if _, updateErr := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "failed", ErrorMessage: &msg}); updateErr != nil {
			log.Error("failed to mark task failed", "error", updateErr)
		}
		return
	}
	if _, err := w.api.UpdateTask(ctx, task.ID, client.TaskPatch{Status: "completed", ResultObjectID: &draft.ID}); err != nil {
		log.Error("failed to mark task completed", "object_id", draft.ID, "error", err)
		return
	}
	log.Debug("task completed", "object_id", draft.ID)
	if err := os.Remove(result.Path); err != nil {
		log.Warn("failed to remove local downloaded file", "path", result.Path, "error", err)
	}
}

func (w *Worker) canStart(taskID string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, exists := w.running[taskID]; exists {
		return false
	}
	if len(w.running) >= w.cfg.MaxConcurrentTasks {
		return false
	}
	w.running[taskID] = struct{}{}
	return true
}

func (w *Worker) finish(taskID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.running, taskID)
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
		w.engine = selectEngine(w.cfg)
		return nil
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
				return engine.Aria2{URL: cfg.Aria2URL, Secret: cfg.Aria2Secret, Dir: cfg.DownloadDir}
			},
			start:   startAria2,
			canAuto: true,
		},
		{
			name:   "qbittorrent",
			binary: []string{"qbittorrent-nox", "qbittorrent"},
			engine: func(cfg config.Config) engine.Engine {
				return engine.QBittorrent{URL: cfg.QBittorrentURL, Username: cfg.QBittorrentUser, Password: cfg.QBittorrentPass, Dir: cfg.DownloadDir}
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
		return engine.Aria2{URL: cfg.Aria2URL, Secret: cfg.Aria2Secret, Dir: cfg.DownloadDir}
	case "qbittorrent":
		return engine.QBittorrent{
			URL:      cfg.QBittorrentURL,
			Username: cfg.QBittorrentUser,
			Password: cfg.QBittorrentPass,
			Dir:      cfg.DownloadDir,
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

func uploadFile(ctx context.Context, url, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, file)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("upload failed: %s", res.Status)
	}
	return nil
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
