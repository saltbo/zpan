package config

import (
	"gopkg.in/yaml.v2"
	"io/ioutil"
	"log"
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

func Parse(filename string) *Config {
	buff, err := ioutil.ReadFile(filename)
	if err != nil {
		log.Fatalf("read config file failed: %v", err)
	}

	conf := new(Config)
	if err := yaml.Unmarshal(buff, conf); err != nil {
		log.Fatalf("unmarshal yaml config failed: %v", err)
	}

	return conf
}
