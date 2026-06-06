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
		Token:              v.GetString("downloader.token"),
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
