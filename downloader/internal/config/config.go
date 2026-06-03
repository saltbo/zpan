package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	ServerURL          string
	Token              string
	Engine             string
	DownloadDir        string
	PollInterval       time.Duration
	MaxConcurrentTasks int
	Aria2URL           string
	Aria2Secret        string
	QBittorrentURL     string
	QBittorrentUser    string
	QBittorrentPass    string
}

func Defaults(v *viper.Viper) {
	home, _ := os.UserHomeDir()
	v.SetDefault("server_url", "http://localhost:5173")
	v.SetDefault("engine", "auto")
	v.SetDefault("download_dir", filepath.Join(home, "Downloads", "zpan"))
	v.SetDefault("poll_interval", "5s")
	v.SetDefault("max_concurrent_tasks", 2)
	v.SetDefault("aria2.url", "ws://127.0.0.1:6800/jsonrpc")
	v.SetDefault("qbittorrent.url", "http://127.0.0.1:8080")
}

func Load(v *viper.Viper) (Config, error) {
	Defaults(v)
	v.SetEnvPrefix("zpan_downloader")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !errors.As(err, &notFound) && !errors.Is(err, os.ErrNotExist) {
			return Config{}, err
		}
	}

	interval, err := time.ParseDuration(v.GetString("poll_interval"))
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		ServerURL:          strings.TrimRight(v.GetString("server_url"), "/"),
		Token:              v.GetString("token"),
		Engine:             v.GetString("engine"),
		DownloadDir:        v.GetString("download_dir"),
		PollInterval:       interval,
		MaxConcurrentTasks: v.GetInt("max_concurrent_tasks"),
		Aria2URL:           v.GetString("aria2.url"),
		Aria2Secret:        v.GetString("aria2.secret"),
		QBittorrentURL:     v.GetString("qbittorrent.url"),
		QBittorrentUser:    v.GetString("qbittorrent.username"),
		QBittorrentPass:    v.GetString("qbittorrent.password"),
	}
	if cfg.ServerURL == "" {
		return Config{}, errors.New("server_url is required")
	}
	if cfg.Token == "" {
		return Config{}, errors.New("token is required")
	}
	if cfg.MaxConcurrentTasks < 1 {
		return Config{}, errors.New("max_concurrent_tasks must be at least 1")
	}
	return cfg, nil
}

func DefaultConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "zpan-downloader.yaml"
	}
	return filepath.Join(home, ".config", "zpan-downloader", "config.yaml")
}
