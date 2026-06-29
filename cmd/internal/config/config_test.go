package config

import (
	"os"
	"path/filepath"
	"strconv"
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
	v.Set("downloader.seed.max_concurrent", 7)

	cfg, err := Load(v)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if !cfg.SeedEnabled {
		t.Fatal("expected seed policy to be enabled")
	}
	if cfg.SeedMaxConcurrent != 7 {
		t.Fatalf("expected seed max_concurrent 7, got %d", cfg.SeedMaxConcurrent)
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
	if cfg.SeedMaxConcurrent != 10 {
		t.Fatalf("expected default seed max_concurrent 10, got %d", cfg.SeedMaxConcurrent)
	}
	if cfg.Token != "" {
		t.Fatalf("expected missing token to be accepted for device login bootstrap, got %q", cfg.Token)
	}
	if cfg.BTListenPort != 6881 {
		t.Fatalf("expected default BT listen port 6881, got %d", cfg.BTListenPort)
	}
}

func TestLoadParsesBTListenPort(t *testing.T) {
	v := viper.New()
	v.Set("server_url", "http://localhost:5173")
	v.Set("downloader.bt_listen_port", 51413)

	cfg, err := Load(v)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.BTListenPort != 51413 {
		t.Fatalf("expected BT listen port 51413, got %d", cfg.BTListenPort)
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
		{name: "max concurrent", key: "downloader.seed.max_concurrent", value: "-1"},
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

func TestLoadRejectsInvalidBTListenPort(t *testing.T) {
	for _, port := range []int{0, 65536} {
		t.Run(strconv.Itoa(port), func(t *testing.T) {
			v := viper.New()
			v.Set("server_url", "http://localhost:5173")
			v.Set("downloader.bt_listen_port", port)

			if _, err := Load(v); err == nil {
				t.Fatal("expected Load to reject invalid BT listen port")
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
	if !strings.Contains(text, "  bt_listen_port: 6881") {
		t.Fatalf("expected default BT listen port, got:\n%s", text)
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
		MaxConcurrentTasks: 5,
		BTListenPort:       51413,
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
	if !strings.Contains(text, "  bt_listen_port: 51413") {
		t.Fatalf("expected custom BT listen port, got:\n%s", text)
	}
}

func TestConfigFormattingHelpers(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", "/xdg/data")
	if got := defaultGeoIPDBPath("/home/me"); got != filepath.Join("/xdg/data", "zpan", "geoip.mmdb") {
		t.Fatalf("unexpected xdg geoip path: %s", got)
	}
	t.Setenv("XDG_DATA_HOME", "")
	if got := defaultGeoIPDBPath("/home/me"); got != filepath.Join("/home/me", ".local", "share", "zpan", "geoip.mmdb") {
		t.Fatalf("unexpected default geoip path: %s", got)
	}
	if got := defaultStateDir(""); got != filepath.Join(".zpan", "downloader") {
		t.Fatalf("unexpected empty-home state dir: %s", got)
	}
	if got := defaultStateDir("/home/me"); got != filepath.Join("/home/me", ".local", "state", "zpan", "downloader") {
		t.Fatalf("unexpected state dir: %s", got)
	}
	if got := formatSeedCacheLimit(1234); got != "1234" {
		t.Fatalf("unexpected seed cache limit: %s", got)
	}
	if got := formatDuration(0, "5s"); got != "5s" {
		t.Fatalf("unexpected fallback duration: %s", got)
	}
	if got := formatDuration(time.Hour, "5s"); got != "1h" {
		t.Fatalf("unexpected hour duration: %s", got)
	}
	if got := formatDuration(1500*time.Millisecond, "5s"); got != "1.5s" {
		t.Fatalf("unexpected fractional duration: %s", got)
	}
	if got := DefaultConfigPath(); !strings.HasSuffix(got, filepath.Join(".config", "zpan", "config.yaml")) {
		t.Fatalf("unexpected default config path: %s", got)
	}
}

func TestWriteRuntimeBlocksWhenConfigured(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := Config{
		ServerURL:             "https://zpan.space",
		Engine:                "qbittorrent",
		DownloadDir:           "/downloads",
		StateDir:              "/state",
		PollInterval:          time.Second,
		MaxConcurrentTasks:    1,
		SeedDuration:          time.Minute,
		SeedMaxConcurrent:     1,
		Aria2Configured:       true,
		Aria2Secret:           "secret",
		QBittorrentConfigured: true,
		QBittorrentUser:       "admin",
		QBittorrentPass:       "password",
	}
	if err := WriteConfig(path, cfg, "token"); err != nil {
		t.Fatal(err)
	}
	text := readConfigFile(t, path)
	if !hasConfigLine(text, "  aria2:") || !strings.Contains(text, `    secret: "secret"`) {
		t.Fatalf("expected aria2 runtime block, got:\n%s", text)
	}
	if !hasConfigLine(text, "  qbittorrent:") ||
		!strings.Contains(text, `    username: "admin"`) ||
		!strings.Contains(text, `    password: "password"`) {
		t.Fatalf("expected qbittorrent runtime block, got:\n%s", text)
	}
}

func readConfigFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

func hasConfigLine(text string, line string) bool {
	for _, candidate := range strings.Split(text, "\n") {
		if candidate == line {
			return true
		}
	}
	return false
}
