package config

import (
	"log"

	"github.com/saltbo/gopkg/gormutil"
	"github.com/spf13/viper"
)

// CloudProvider
type Provider struct {
	Name         string
	Bucket       string
	Endpoint     string
	AccessKey    string
	AccessSecret string
}

type Config struct {
	SiteHost  string
	StoreHost string
	Database  gormutil.Config
	Provider  *Provider
}

func Parse() *Config {
	conf := new(Config)
	if err := viper.Unmarshal(conf); err != nil {
		log.Fatalf("unmarshal yaml config failed: %v", err)
	}

	return conf
}
