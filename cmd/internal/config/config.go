package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/docker/go-units"
	"github.com/spf13/viper"
)

type Config struct {
	ServerURL             string
	Token                 string
	Engine                string
	DownloadDir           string
	StateDir              string
	PollInterval          time.Duration
	MaxConcurrentTasks    int
	Aria2URL              string
	Aria2Secret           string
	QBittorrentURL        string
	QBittorrentUser       string
	QBittorrentPass       string
	SeedEnabled           bool
	SeedDuration          time.Duration
	SeedCacheLimit        int64
	SeedRatio             float64
	Aria2Configured       bool
	QBittorrentConfigured bool
}

const (
	DefaultAria2URL       = "ws://127.0.0.1:6800/jsonrpc"
	DefaultQBittorrentURL = "http://127.0.0.1:8080"
)

func Defaults(v *viper.Viper) {
	home, _ := os.UserHomeDir()
	v.SetDefault("server_url", "http://localhost:5173")
	v.SetDefault("token", "")
	v.SetDefault("downloader.engine", "auto")
	v.SetDefault("downloader.download_dir", filepath.Join(home, "Downloads", "zpan"))
	v.SetDefault("downloader.state_dir", defaultStateDir(home))
	v.SetDefault("downloader.poll_interval", "5s")
	v.SetDefault("downloader.max_concurrent_tasks", 2)
	v.SetDefault("downloader.aria2.url", DefaultAria2URL)
	v.SetDefault("downloader.qbittorrent.url", DefaultQBittorrentURL)
	v.SetDefault("downloader.seed.enabled", true)
	v.SetDefault("downloader.seed.duration", "1h")
	v.SetDefault("downloader.seed.cache_limit", "10GB")
	v.SetDefault("downloader.seed.ratio", 0)
}

func Load(v *viper.Viper) (Config, error) {
	v.SetEnvPrefix("zpan")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !errors.As(err, &notFound) && !errors.Is(err, os.ErrNotExist) {
			return Config{}, err
		}
	}
	aria2Configured := explicitValue(v, "downloader.aria2.url") || explicitValue(v, "downloader.aria2.secret")
	qbittorrentConfigured := explicitValue(v, "downloader.qbittorrent.url") ||
		explicitValue(v, "downloader.qbittorrent.username") ||
		explicitValue(v, "downloader.qbittorrent.password")
	Defaults(v)

	interval, err := time.ParseDuration(v.GetString("downloader.poll_interval"))
	if err != nil {
		return Config{}, err
	}
	seedDuration, err := time.ParseDuration(v.GetString("downloader.seed.duration"))
	if err != nil {
		return Config{}, err
	}
	seedCacheLimit, err := parseBytes(v.GetString("downloader.seed.cache_limit"))
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		ServerURL:          strings.TrimRight(v.GetString("server_url"), "/"),
		Token:              v.GetString("token"),
		Engine:             v.GetString("downloader.engine"),
		DownloadDir:        v.GetString("downloader.download_dir"),
		StateDir:           v.GetString("downloader.state_dir"),
		PollInterval:       interval,
		MaxConcurrentTasks: v.GetInt("downloader.max_concurrent_tasks"),
		Aria2URL:           v.GetString("downloader.aria2.url"),
		Aria2Secret:        v.GetString("downloader.aria2.secret"),
		QBittorrentURL:     v.GetString("downloader.qbittorrent.url"),
		QBittorrentUser:    v.GetString("downloader.qbittorrent.username"),
		QBittorrentPass:    v.GetString("downloader.qbittorrent.password"),
		SeedEnabled:        v.GetBool("downloader.seed.enabled"),
		SeedDuration:       seedDuration,
		SeedCacheLimit:     seedCacheLimit,
		SeedRatio:          v.GetFloat64("downloader.seed.ratio"),
		Aria2Configured: aria2Configured &&
			(v.GetString("downloader.aria2.url") != DefaultAria2URL || v.GetString("downloader.aria2.secret") != ""),
		QBittorrentConfigured: qbittorrentConfigured &&
			(v.GetString("downloader.qbittorrent.url") != DefaultQBittorrentURL ||
				v.GetString("downloader.qbittorrent.username") != "" ||
				v.GetString("downloader.qbittorrent.password") != ""),
	}
	if cfg.ServerURL == "" {
		return Config{}, errors.New("server_url is required")
	}
	if cfg.MaxConcurrentTasks < 1 {
		return Config{}, errors.New("max_concurrent_tasks must be at least 1")
	}
	if cfg.StateDir == "" {
		return Config{}, errors.New("state_dir is required")
	}
	if cfg.SeedDuration < 0 {
		return Config{}, errors.New("downloader.seed.duration must not be negative")
	}
	if cfg.SeedCacheLimit < 0 {
		return Config{}, errors.New("downloader.seed.cache_limit must not be negative")
	}
	if cfg.SeedRatio < 0 {
		return Config{}, errors.New("downloader.seed.ratio must not be negative")
	}
	return cfg, nil
}

func explicitValue(v *viper.Viper, key string) bool {
	return v.IsSet(key)
}

func WriteDefaultConfig(path string) error {
	home, _ := os.UserHomeDir()
	cfg := Config{
		ServerURL:          "http://localhost:5173",
		Engine:             "auto",
		DownloadDir:        filepath.Join(home, "Downloads", "zpan"),
		StateDir:           defaultStateDir(home),
		PollInterval:       5 * time.Second,
		MaxConcurrentTasks: 2,
		SeedEnabled:        true,
		SeedDuration:       time.Hour,
		SeedCacheLimit:     10_000_000_000,
		SeedRatio:          0,
	}
	return createConfigFile(path, defaultConfigYAML(cfg))
}

func WriteConfig(path string, cfg Config, token string) error {
	cfg.Token = token
	return writeConfigFile(path, configYAML(cfg, false))
}

func createConfigFile(path string, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString(content)
	return err
}

func writeConfigFile(path string, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

func defaultConfigYAML(cfg Config) string {
	return "# ZPan CLI configuration\n" +
		"# token is written automatically after device login.\n" +
		"# token: \"\"\n\n" +
		configYAML(cfg, true)
}

func configYAML(cfg Config, includeRuntimeHints bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "server_url: %s\n", yamlString(cfg.ServerURL))
	if cfg.Token != "" {
		fmt.Fprintf(&b, "token: %s\n", yamlString(cfg.Token))
	}
	b.WriteString("downloader:\n")
	fmt.Fprintf(&b, "  engine: %s\n", yamlString(nonEmpty(cfg.Engine, "auto")))
	fmt.Fprintf(&b, "  download_dir: %s\n", yamlString(cfg.DownloadDir))
	fmt.Fprintf(&b, "  state_dir: %s\n", yamlString(cfg.StateDir))
	fmt.Fprintf(&b, "  poll_interval: %s\n", yamlString(formatDuration(cfg.PollInterval, "5s")))
	fmt.Fprintf(&b, "  max_concurrent_tasks: %d\n", cfg.MaxConcurrentTasks)
	b.WriteString("  seed:\n")
	fmt.Fprintf(&b, "    enabled: %t\n", cfg.SeedEnabled)
	fmt.Fprintf(&b, "    duration: %s\n", yamlString(formatDuration(cfg.SeedDuration, "1h")))
	fmt.Fprintf(&b, "    cache_limit: %s\n", yamlString(formatSeedCacheLimit(cfg.SeedCacheLimit)))
	fmt.Fprintf(&b, "    ratio: %s\n", strconv.FormatFloat(cfg.SeedRatio, 'f', -1, 64))
	if shouldWriteAria2Config(cfg) {
		b.WriteString("  aria2:\n")
		fmt.Fprintf(&b, "    url: %s\n", yamlString(nonEmpty(cfg.Aria2URL, DefaultAria2URL)))
		if cfg.Aria2Secret != "" {
			fmt.Fprintf(&b, "    secret: %s\n", yamlString(cfg.Aria2Secret))
		}
	}
	if shouldWriteQBittorrentConfig(cfg) {
		b.WriteString("  qbittorrent:\n")
		fmt.Fprintf(&b, "    url: %s\n", yamlString(nonEmpty(cfg.QBittorrentURL, DefaultQBittorrentURL)))
		if cfg.QBittorrentUser != "" {
			fmt.Fprintf(&b, "    username: %s\n", yamlString(cfg.QBittorrentUser))
		}
		if cfg.QBittorrentPass != "" {
			fmt.Fprintf(&b, "    password: %s\n", yamlString(cfg.QBittorrentPass))
		}
	}
	if includeRuntimeHints {
		b.WriteString("\n")
		b.WriteString("  # To connect an external aria2 runtime, set engine to \"aria2\"\n")
		b.WriteString("  # and uncomment this block.\n")
		fmt.Fprintf(&b, "  # aria2:\n")
		fmt.Fprintf(&b, "  #   url: %s\n", yamlString(DefaultAria2URL))
		fmt.Fprintf(&b, "  #   secret: %s\n", yamlString("optional-rpc-secret"))
		b.WriteString("\n")
		b.WriteString("  # To connect an external qBittorrent runtime, set engine to \"qbittorrent\"\n")
		b.WriteString("  # and uncomment this block.\n")
		fmt.Fprintf(&b, "  # qbittorrent:\n")
		fmt.Fprintf(&b, "  #   url: %s\n", yamlString(DefaultQBittorrentURL))
		fmt.Fprintf(&b, "  #   username: %s\n", yamlString("admin"))
		fmt.Fprintf(&b, "  #   password: %s\n", yamlString("password"))
	}
	return b.String()
}

func shouldWriteAria2Config(cfg Config) bool {
	return strings.EqualFold(cfg.Engine, "aria2") || cfg.Aria2Configured
}

func shouldWriteQBittorrentConfig(cfg Config) bool {
	return strings.EqualFold(cfg.Engine, "qbittorrent") || cfg.QBittorrentConfigured
}

func yamlString(value string) string {
	return strconv.Quote(value)
}

func nonEmpty(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func formatSeedCacheLimit(value int64) string {
	if value == 10_000_000_000 {
		return "10GB"
	}
	return strconv.FormatInt(value, 10)
}

func formatDuration(value time.Duration, fallback string) string {
	if value == 0 {
		return fallback
	}
	if value == time.Hour {
		return "1h"
	}
	if value%time.Second == 0 {
		return value.String()
	}
	return value.String()
}

func parseBytes(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}
	parsed, err := units.FromHumanSize(value)
	if err != nil {
		return 0, err
	}
	return parsed, nil
}

func DefaultConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "config.yaml"
	}
	return filepath.Join(home, ".config", "zpan", "config.yaml")
}

func defaultStateDir(home string) string {
	if home == "" {
		return filepath.Join(".zpan", "downloader")
	}
	return filepath.Join(home, ".local", "state", "zpan", "downloader")
}
