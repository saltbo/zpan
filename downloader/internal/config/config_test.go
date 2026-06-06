package config

import (
	"testing"
	"time"

	"github.com/spf13/viper"
)

func TestLoadParsesSeedPolicy(t *testing.T) {
	v := viper.New()
	v.Set("server_url", "http://localhost:5173")
	v.Set("token", "token")
	v.Set("seed.enabled", true)
	v.Set("seed.duration", "30m")
	v.Set("seed.cache_limit", "10GB")
	v.Set("seed.ratio", 1.5)

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
	v.Set("aria2.url", "ws://aria2:6800/jsonrpc")

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
		{name: "duration", key: "seed.duration", value: "-1s"},
		{name: "cache limit", key: "seed.cache_limit", value: "-1GB"},
		{name: "ratio", key: "seed.ratio", value: "-1"},
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
