package config

import (
	"log"

	"github.com/saltbo/gopkg/gormutil"
	"github.com/spf13/viper"

	"github.com/saltbo/zpan/disk"
)

type Config struct {
	Debug    bool
	Storage  uint64
	Database gormutil.Config
	Provider disk.Config
}

func Parse() *Config {
	conf := new(Config)
	if err := viper.Unmarshal(conf); err != nil {
		log.Fatalf("unmarshal yaml config failed: %v", err)
	}

	return conf
}
