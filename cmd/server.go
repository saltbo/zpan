package main

import (
	"log"
	"math/rand"
	"os"
	"time"

	"github.com/urfave/cli"

	"zpan/api"
	"zpan/config"
	"zpan/dao"
	"zpan/disk"
	"zpan/version"
)

const (
	// uploader configs
	UPTOC_UPLOADER_OSS = "alioss"
)

var (
	appFlags = []cli.Flag{
		cli.StringFlag{
			Name:  "config,c",
			Usage: "specify path of the config file. default: config.yaml",
			Value: "config.yaml",
		},
	}
)

func main() {
	app := cli.NewApp()
	app.Name = "zpan"
	app.Usage = "A cloud disk base on the cloud storage."
	app.Copyright = "(c) 2019 zpan.saltbo.cn"
	app.Compiled = time.Now()
	app.Version = version.Short
	app.Flags = appFlags
	app.Action = serve
	if err := app.Run(os.Args); err != nil {
		log.Fatal(err)
	}
}

func serve(c *cli.Context) {
	rand.Seed(time.Now().UnixNano())
	conf := config.Parse(c.String("config"))
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
