package config

import (
	"log"

	"github.com/spf13/viper"
)

// CloudProvider
type Provider struct {
	Name         string `yaml:"name"`
	Bucket       string `yaml:"bucket"`
	Endpoint     string `yaml:"endpoint"`
	AccessKey    string `yaml:"access_key"`
	AccessSecret string `yaml:"access_secret"`
}

type Config struct {
	SiteHost  string    `yaml:"site_host"`
	StoreHost string    `yaml:"store_host"`
	MySqlDSN  string    `yaml:"mysqldsn"`
	Provider  *Provider `yaml:"provider"`
}

func Parse() *Config {
	conf := new(Config)
	if err := viper.Unmarshal(conf); err != nil {
		log.Fatalf("unmarshal yaml config failed: %v", err)
	}

	return conf
}
