package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/spf13/viper"
)

func TestLoadParsesSeedPolicy(t *testing.T) {
	v := viper.New()
	v.Set("server_url", "http://localhost:5173")
	v.Set("token", "token")
	v.Set("downloader.seed.enabled", true)
	v.Set("downloader.seed.duration", "30m")
	v.Set("downloader.seed.cache_limit", "10GB")
	v.Set("downloader.seed.ratio", 1.5)

	cfg, err := Load(v)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if !cfg.SeedEnabled {
		t.Fatal("expected seed policy to be enabled")
	}
	if cfg.SeedDuration != 30*time.Minute {
		t.Fatalf("expected seed duration 30m, got %s", cfg.SeedDuration)
	}
	if cfg.SeedCacheLimit != 10_000_000_000 {
		t.Fatalf("expected seed cache limit 10GB, got %d", cfg.SeedCacheLimit)
	}
	if cfg.SeedRatio != 1.5 {
		t.Fatalf("expected seed ratio 1.5, got %f", cfg.SeedRatio)
	}
	if cfg.Token != "token" {
		t.Fatalf("expected global token to be loaded, got %q", cfg.Token)
	}
}

func TestLoadUsesSafeSeedDefaults(t *testing.T) {
	v := viper.New()
	v.Set("server_url", "http://localhost:5173")

	cfg, err := Load(v)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if !cfg.SeedEnabled {
		t.Fatal("expected seed policy to be enabled by default")
	}
	if cfg.SeedDuration != time.Hour {
		t.Fatalf("expected default seed duration 1h, got %s", cfg.SeedDuration)
	}
	if cfg.SeedCacheLimit != 10_000_000_000 {
		t.Fatalf("expected default seed cache limit 10GB, got %d", cfg.SeedCacheLimit)
	}
	if cfg.Token != "" {
		t.Fatalf("expected missing token to be accepted for device login bootstrap, got %q", cfg.Token)
	}
}

func TestLoadDoesNotTreatDefaultRuntimeURLsAsConfigured(t *testing.T) {
	v := viper.New()
	v.Set("server_url", "http://localhost:5173")

	cfg, err := Load(v)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Aria2Configured {
		t.Fatal("default aria2 url should not force configured external runtime mode")
	}
	if cfg.QBittorrentConfigured {
		t.Fatal("default qbittorrent url should not force configured external runtime mode")
	}
}

func TestLoadTreatsExternalRuntimeOverridesAsConfigured(t *testing.T) {
	v := viper.New()
	v.Set("server_url", "http://localhost:5173")
	v.Set("downloader.aria2.url", "ws://aria2:6800/jsonrpc")

	cfg, err := Load(v)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if !cfg.Aria2Configured {
		t.Fatal("expected custom aria2 url to configure external runtime mode")
	}
}

func TestLoadRejectsInvalidSeedPolicy(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{name: "duration", key: "downloader.seed.duration", value: "-1s"},
		{name: "cache limit", key: "downloader.seed.cache_limit", value: "-1GB"},
		{name: "ratio", key: "downloader.seed.ratio", value: "-1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := viper.New()
			v.Set("server_url", "http://localhost:5173")
			v.Set("token", "token")
			v.Set(tt.key, tt.value)

			if _, err := Load(v); err == nil {
				t.Fatal("expected Load to reject invalid seed policy")
			}
		})
	}
}

func TestWriteDefaultConfigWritesCommentedRuntimeHints(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := WriteDefaultConfig(path, "https://zpan.space/"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	if !strings.Contains(text, `server_url: "https://zpan.space"`) {
		t.Fatalf("expected custom server URL, got:\n%s", text)
	}
	if strings.Contains(text, "token:") && !strings.Contains(text, "# token:") {
		t.Fatalf("expected token to be commented in default config, got:\n%s", text)
	}
	if hasConfigLine(text, "  aria2:") {
		t.Fatalf("default config should not enable aria2 runtime block, got:\n%s", text)
	}
	if hasConfigLine(text, "  qbittorrent:") {
		t.Fatalf("default config should not enable qbittorrent runtime block, got:\n%s", text)
	}
	if !strings.Contains(text, "  #   url: \"ws://127.0.0.1:6800/jsonrpc\"") {
		t.Fatalf("expected commented aria2 runtime hint, got:\n%s", text)
	}
}

func TestWriteConfigStoresGlobalTokenAndOmitsDefaultRuntimeBlocks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := Config{
		ServerURL:          "https://zpan.space",
		Engine:             "auto",
		DownloadDir:        "/downloads",
		StateDir:           "/state",
		PollInterval:       5 * time.Second,
		MaxConcurrentTasks: 2,
		SeedEnabled:        true,
		SeedDuration:       time.Hour,
		SeedCacheLimit:     10_000_000_000,
	}
	if err := WriteConfig(path, cfg, "download-token"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	if !strings.Contains(text, "token: \"download-token\"") {
		t.Fatalf("expected global token, got:\n%s", text)
	}
	if strings.Contains(text, "downloader:\n  token:") || hasConfigLine(text, "  aria2:") || hasConfigLine(text, "  qbittorrent:") {
		t.Fatalf("expected no downloader token or default runtime blocks, got:\n%s", text)
	}
}

func hasConfigLine(text string, line string) bool {
	for _, candidate := range strings.Split(text, "\n") {
		if candidate == line {
			return true
		}
	}
	return false
}
