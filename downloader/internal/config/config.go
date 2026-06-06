package config

import (
	"errors"
	"os"
	"path/filepath"
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
	v.SetDefault("engine", "auto")
	v.SetDefault("download_dir", filepath.Join(home, "Downloads", "zpan"))
	v.SetDefault("state_dir", defaultStateDir(home))
	v.SetDefault("poll_interval", "5s")
	v.SetDefault("max_concurrent_tasks", 2)
	v.SetDefault("aria2.url", DefaultAria2URL)
	v.SetDefault("qbittorrent.url", DefaultQBittorrentURL)
	v.SetDefault("seed.enabled", true)
	v.SetDefault("seed.duration", "1h")
	v.SetDefault("seed.cache_limit", "10GB")
	v.SetDefault("seed.ratio", 0)
}

func Load(v *viper.Viper) (Config, error) {
	v.SetEnvPrefix("zpan_downloader")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !errors.As(err, &notFound) && !errors.Is(err, os.ErrNotExist) {
			return Config{}, err
		}
	}
	aria2Configured := explicitValue(v, "aria2.url", "ARIA2_URL") || explicitValue(v, "aria2.secret", "ARIA2_SECRET")
	qbittorrentConfigured := explicitValue(v, "qbittorrent.url", "QBITTORRENT_URL") ||
		explicitValue(v, "qbittorrent.username", "QBITTORRENT_USERNAME") ||
		explicitValue(v, "qbittorrent.password", "QBITTORRENT_PASSWORD")
	Defaults(v)

	interval, err := time.ParseDuration(v.GetString("poll_interval"))
	if err != nil {
		return Config{}, err
	}
	seedDuration, err := time.ParseDuration(v.GetString("seed.duration"))
	if err != nil {
		return Config{}, err
	}
	seedCacheLimit, err := parseBytes(v.GetString("seed.cache_limit"))
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		ServerURL:          strings.TrimRight(v.GetString("server_url"), "/"),
		Token:              v.GetString("token"),
		Engine:             v.GetString("engine"),
		DownloadDir:        v.GetString("download_dir"),
		StateDir:           v.GetString("state_dir"),
		PollInterval:       interval,
		MaxConcurrentTasks: v.GetInt("max_concurrent_tasks"),
		Aria2URL:           v.GetString("aria2.url"),
		Aria2Secret:        v.GetString("aria2.secret"),
		QBittorrentURL:     v.GetString("qbittorrent.url"),
		QBittorrentUser:    v.GetString("qbittorrent.username"),
		QBittorrentPass:    v.GetString("qbittorrent.password"),
		SeedEnabled:        v.GetBool("seed.enabled"),
		SeedDuration:       seedDuration,
		SeedCacheLimit:     seedCacheLimit,
		SeedRatio:          v.GetFloat64("seed.ratio"),
		Aria2Configured:    aria2Configured && (v.GetString("aria2.url") != DefaultAria2URL || v.GetString("aria2.secret") != ""),
		QBittorrentConfigured: qbittorrentConfigured &&
			(v.GetString("qbittorrent.url") != DefaultQBittorrentURL ||
				v.GetString("qbittorrent.username") != "" ||
				v.GetString("qbittorrent.password") != ""),
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
		return Config{}, errors.New("seed.duration must not be negative")
	}
	if cfg.SeedCacheLimit < 0 {
		return Config{}, errors.New("seed.cache_limit must not be negative")
	}
	if cfg.SeedRatio < 0 {
		return Config{}, errors.New("seed.ratio must not be negative")
	}
	return cfg, nil
}

func explicitValue(v *viper.Viper, key string, envName string) bool {
	if os.Getenv("ZPAN_DOWNLOADER_"+envName) != "" {
		return true
	}
	return v.IsSet(key)
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
		return "zpan-downloader.yaml"
	}
	return filepath.Join(home, ".config", "zpan-downloader", "config.yaml")
}

func defaultStateDir(home string) string {
	if home == "" {
		return ".zpan-downloader"
	}
	return filepath.Join(home, ".local", "state", "zpan-downloader")
}
