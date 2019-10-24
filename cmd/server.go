package main

import (
	"log"
	"math/rand"
	"time"
	"zpan/api"
	"zpan/config"
	"zpan/dao"
	"zpan/disk"
)

const (
	// uploader configs
	UPTOC_UPLOADER_OSS = "alioss"
)

func main() {
	rand.Seed(time.Now().UnixNano())
	conf := config.Parse("config.yaml")
	dao.Init(conf.MySqlDSN)

	// select provider
	var provider disk.Provider
	switch conf.Provider.Name {
	case UPTOC_UPLOADER_OSS:
		ossProvider, err := disk.NewAliOss(conf.Provider)
		if err != nil {
			log.Fatalln(err)
		}

		provider = ossProvider
	default:
		log.Fatalf("provider %s not support.", conf.Provider.Name)
	}

	// init restServer
	rs, err := api.NewRest(conf)
	if err != nil {
		log.Fatalln(err)
	}

	rs.SetupProvider(provider)
	if err := rs.Run(); err != nil {
		log.Fatal(err)
	}
}
