package config

import (
	"log"

	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/gopkg/mailutil"
	"github.com/spf13/viper"

	"github.com/saltbo/zpan/disk"
)

type Config struct {
	Debug      bool
	Invitation bool
	Secret     string
	Storage    uint64
	Email      mailutil.Config
	Database   gormutil.Config
	Provider   disk.Config
}

func Parse() *Config {
	conf := new(Config)
	if err := viper.Unmarshal(conf); err != nil {
		log.Fatalf("unmarshal yaml config failed: %v", err)
	}

	return conf
}
