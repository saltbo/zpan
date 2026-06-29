package downloader

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/zpan/internal/config"
	"github.com/saltbo/zpan/pkg/geoip"
)

const defaultBTDownloader = "aria2"

type Manager struct {
	cfg         config.Config
	geoIP       geoip.Resolver
	logger      *slog.Logger
	downloaders []Downloader
	started     bool
	mu          sync.Mutex
}

func NewManager(cfg config.Config, geoIP geoip.Resolver, logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	return &Manager{cfg: cfg, geoIP: geoIP, logger: logger}
}

func NewManagerWithDownloader(downloader Downloader) *Manager {
	return NewManagerWithDownloaders(downloader)
}

func NewManagerWithDownloaders(downloaders ...Downloader) *Manager {
	return &Manager{downloaders: append([]Downloader(nil), downloaders...), logger: slog.Default(), started: true}
}

func (m *Manager) Start(ctx context.Context, onDownloaderExit func(error)) error {
	if m == nil {
		return errors.New("downloader manager is nil")
	}
	m.mu.Lock()
	if m.started {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	downloaders, err := m.resolveDownloaders(ctx)
	if err != nil {
		return err
	}
	if len(downloaders) == 0 {
		return errors.New("no downloader is available")
	}

	m.mu.Lock()
	m.downloaders = downloaders
	m.started = true
	m.mu.Unlock()
	for _, downloader := range downloaders {
		go m.watchDownloader(ctx, downloader, onDownloaderExit)
	}
	m.logger.Info("downloaders started", "downloaders", m.Name(), "capabilities", m.Capabilities())
	return nil
}

func (m *Manager) Stop(ctx context.Context) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.started = false
	m.mu.Unlock()
	for _, downloader := range m.currentDownloaders() {
		stopCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if err := downloader.Stop(stopCtx); err != nil {
			m.logger.Warn("failed to stop downloader", "downloader", downloader.Name(), "error", err)
		}
		cancel()
	}
}

func (m *Manager) Name() string {
	if m == nil {
		return "auto"
	}
	downloaders := m.currentDownloaders()
	if len(downloaders) == 0 {
		if m.cfg.Engine != "" {
			return m.cfg.Engine
		}
		return "auto"
	}
	names := make([]string, 0, len(downloaders))
	var fallbackName string
	for _, downloader := range downloaders {
		if isHTTPDownloader(downloader) {
			fallbackName = downloader.Name()
			continue
		}
		names = append(names, downloader.Name())
	}
	if len(names) > 0 {
		return strings.Join(names, ",")
	}
	if fallbackName != "" {
		return fallbackName
	}
	return "auto"
}

func (m *Manager) Capabilities() []string {
	downloaders := m.currentDownloaders()
	if len(downloaders) == 0 {
		return []string{"http"}
	}
	seen := map[string]struct{}{}
	var out []string
	for _, downloader := range downloaders {
		for _, sourceType := range downloader.Capabilities().SourceTypes {
			if _, ok := seen[sourceType]; ok {
				continue
			}
			seen[sourceType] = struct{}{}
			out = append(out, sourceType)
		}
	}
	sort.Strings(out)
	return out
}

func (m *Manager) Download(ctx context.Context, task DownloadTask, progress ProgressReporter) (Result, error) {
	downloader, err := m.selectDownloader(task)
	if err != nil {
		return Result{}, err
	}
	return downloader.Download(ctx, task, progress)
}

func (m *Manager) InspectTask(ctx context.Context, task DownloadTask) (TaskSnapshot, bool, error) {
	downloader, err := m.selectDownloader(task)
	if err != nil {
		return TaskSnapshot{}, false, err
	}
	return downloader.InspectTask(ctx, task)
}

func (m *Manager) ResetTask(ctx context.Context, task DownloadTask) error {
	downloader, err := m.selectDownloader(task)
	if err != nil {
		return err
	}
	resetter, ok := downloader.(TaskResetter)
	if !ok {
		return fmt.Errorf("downloader %s does not support task reset", downloader.Name())
	}
	return resetter.ResetTask(ctx, task)
}

func (m *Manager) RestoreSeed(ctx context.Context, ref SeedRef) (*Seed, bool, error) {
	if err := m.ready(); err != nil {
		return nil, false, err
	}
	for _, downloader := range m.currentDownloaders() {
		restorer, ok := downloader.(SeedRestorer)
		if !ok {
			continue
		}
		if ref.Engine != "" && downloader.Name() != ref.Engine {
			continue
		}
		seed, err := restorer.RestoreSeed(ctx, ref)
		return seed, true, err
	}
	return nil, false, nil
}

func (m *Manager) ListSeeds(ctx context.Context) ([]Seed, bool, error) {
	if err := m.ready(); err != nil {
		return nil, false, err
	}
	var out []Seed
	supported := false
	for _, downloader := range m.currentDownloaders() {
		lister, ok := downloader.(SeedLister)
		if !ok {
			continue
		}
		supported = true
		seeds, err := lister.ListSeeds(ctx)
		if err != nil {
			return nil, true, err
		}
		out = append(out, seeds...)
	}
	return out, supported, nil
}

func (m *Manager) ready() error {
	if m == nil || len(m.currentDownloaders()) == 0 {
		return errors.New("downloader manager is not started")
	}
	return nil
}

func (m *Manager) selectDownloader(task DownloadTask) (Downloader, error) {
	if err := m.ready(); err != nil {
		return nil, err
	}
	sourceType := task.SourceType()
	var candidates []Downloader
	for _, downloader := range m.currentDownloaders() {
		if supportsSourceType(downloader.Capabilities(), sourceType) {
			candidates = append(candidates, downloader)
		}
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("no downloader supports source type %q", sourceType)
	}
	return candidates[0], nil
}

func supportsSourceType(capabilities Capabilities, sourceType string) bool {
	for _, supported := range capabilities.SourceTypes {
		if supported == sourceType {
			return true
		}
	}
	return false
}

func (m *Manager) currentDownloaders() []Downloader {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Downloader(nil), m.downloaders...)
}

func (m *Manager) resolveDownloaders(ctx context.Context) ([]Downloader, error) {
	cfg := m.downloaderConfig()
	var entries []registration
	btEntry, hasBT, err := m.btRegistration(cfg)
	if err != nil {
		return nil, err
	}
	if hasBT {
		entries = append(entries, btEntry)
	}
	httpEntry, err := fallbackRegistration()
	if err != nil {
		return nil, err
	}
	entries = append(entries, httpEntry)

	started := make([]Downloader, 0, len(entries))
	for _, entry := range entries {
		downloader, err := entry.new(cfg)
		if err != nil {
			m.stopStartedDownloaders(ctx, started)
			return nil, err
		}
		if err := m.startDownloader(ctx, downloader, true); err != nil {
			m.stopStartedDownloaders(ctx, started)
			return nil, err
		}
		started = append(started, downloader)
	}
	return started, nil
}

func (m *Manager) startDownloader(ctx context.Context, downloader Downloader, required bool) error {
	m.logger.Info("starting downloader", "downloader", downloader.Name())
	if err := downloader.Start(ctx); err != nil {
		if required {
			return fmt.Errorf("start downloader %q: %w", downloader.Name(), err)
		}
		return err
	}
	if err := waitForDownloader(ctx, downloader); err != nil {
		downloader.Stop(context.Background())
		if required {
			return fmt.Errorf("downloader %q is not available: %w", downloader.Name(), err)
		}
		return err
	}
	m.logger.Info("downloader started", "downloader", downloader.Name())
	return nil
}

func (m *Manager) btRegistration(cfg Config) (registration, bool, error) {
	engine := strings.ToLower(strings.TrimSpace(cfg.Engine))
	switch engine {
	case "", "auto":
		configured := configuredExternalRegistrations(cfg)
		if len(configured) > 1 {
			return registration{}, false, fmt.Errorf("multiple BT downloaders are configured; set downloader.engine to one of: %s", strings.Join(registrationNames(configured), ", "))
		}
		if len(configured) == 1 {
			return configured[0], true, nil
		}
		entry, ok := registrationByName(defaultBTDownloader)
		if !ok {
			return registration{}, false, fmt.Errorf("default BT downloader %q is not registered", defaultBTDownloader)
		}
		return entry, true, nil
	case "http":
		return registration{}, false, nil
	default:
		entry, ok := registrationByName(engine)
		if !ok || entry.fallback {
			return registration{}, false, fmt.Errorf("unsupported BT downloader %q; expected auto, http, or one of: %s", cfg.Engine, strings.Join(externalDownloaderNames(), ", "))
		}
		return entry, true, nil
	}
}

func configuredExternalRegistrations(cfg Config) []registration {
	var out []registration
	for _, entry := range externalRegistrations() {
		if entry.configured(cfg) {
			out = append(out, entry)
		}
	}
	return out
}

func fallbackRegistration() (registration, error) {
	for _, entry := range registrations() {
		if entry.fallback {
			return entry, nil
		}
	}
	return registration{}, errors.New("http downloader is not registered")
}

func registrationByName(name string) (registration, bool) {
	for _, entry := range registrations() {
		if entry.name == name {
			return entry, true
		}
	}
	return registration{}, false
}

func registrationNames(entries []registration) []string {
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.name)
	}
	return names
}

func externalDownloaderNames() []string {
	return registrationNames(externalRegistrations())
}

func (m *Manager) downloaderConfig() Config {
	return Config{
		Engine:                 m.cfg.Engine,
		DownloadDir:            m.cfg.DownloadDir,
		StateDir:               m.cfg.StateDir,
		BTListenPort:           m.cfg.BTListenPort,
		MaxConcurrentDownloads: aria2MaxConcurrentDownloads(m.cfg),
		SeedEnabled:            m.cfg.SeedEnabled,
		SeedDuration:           m.cfg.SeedDuration,
		SeedRatio:              m.cfg.SeedRatio,
		Aria2: Aria2Config{
			URL:        m.cfg.Aria2URL,
			Secret:     m.cfg.Aria2Secret,
			Configured: m.cfg.Aria2Configured,
		},
		QBittorrent: QBittorrentConfig{
			URL:        m.cfg.QBittorrentURL,
			Username:   m.cfg.QBittorrentUser,
			Password:   m.cfg.QBittorrentPass,
			Configured: m.cfg.QBittorrentConfigured,
		},
		GeoIP: m.geoIP,
	}
}

func externalRegistrations() []registration {
	var out []registration
	for _, entry := range registrations() {
		if entry.fallback {
			continue
		}
		out = append(out, entry)
	}
	return out
}

func (m *Manager) stopStartedDownloaders(ctx context.Context, downloaders []Downloader) {
	for _, downloader := range downloaders {
		stopCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if err := downloader.Stop(stopCtx); err != nil {
			m.logger.Warn("failed to stop downloader after startup error", "downloader", downloader.Name(), "error", err)
		}
		cancel()
	}
}

func isHTTPDownloader(downloader Downloader) bool {
	return downloader.Name() == "http"
}

func aria2MaxConcurrentDownloads(cfg config.Config) int {
	limit := cfg.MaxConcurrentTasks
	if cfg.SeedEnabled {
		limit += cfg.SeedMaxConcurrent
	}
	return limit
}

func waitForDownloader(ctx context.Context, downloader Downloader) error {
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

func (m *Manager) watchDownloader(ctx context.Context, downloader Downloader, onDownloaderExit func(error)) {
	if onDownloaderExit == nil {
		return
	}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !m.isStarted() {
				return
			}
			checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			err := downloader.Check(checkCtx)
			cancel()
			if err == nil {
				continue
			}
			onDownloaderExit(fmt.Errorf("%s health check failed: %w", downloader.Name(), err))
			return
		}
	}
}

func (m *Manager) isStarted() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.started
}
