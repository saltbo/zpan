package config

import (
	"log"

	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/gopkg/mailutil"
	"github.com/spf13/viper"

	"github.com/saltbo/zpan/provider"
)

type Config struct {
	Debug      bool
	Invitation bool
	Secret     string
	Storage    uint64
	Email      mailutil.Config
	Database   gormutil.Config
	Provider   provider.Config
	Server     Server
	TLS        TLS
}

type Server struct {
	Domain  []string
	Port    int
	SSLPort int
}

type TLS struct {
	Enabled     bool
	Auto        bool
	CacheDir    string
	CertPath    string
	CertkeyPath string
}

func (c *Config) EmailAct() bool {
	return c.Email.Host != ""
}

func Parse() *Config {
	conf := new(Config)
	if err := viper.Unmarshal(conf); err != nil {
		log.Fatalf("unmarshal yaml config failed: %v", err)
	}

	return conf
}
