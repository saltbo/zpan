package main

import (
	"log"
	"os"

	"zpan/api"
	"zpan/cloudengine"
	"zpan/dao"
)

const DEFAULT_MYSQL_DSN = "root:root@tcp(127.0.0.1:3306)/zpan?charset=utf8&interpolateParams=true"

var (
	err             error
	Endpoint        string
	AccessKeyID     string
	AccessKeySecret string
	OSSBucket       string
)

func assertNoError(err error, msgAndArgs ...interface{}) {
	if err != nil {
		log.Fatalf(err.Error(), msgAndArgs...)
	}
}

func main() {
	dsn := os.Getenv("ZPAN_MYSQL_DSN")
	if dsn == "" {
		dsn = DEFAULT_MYSQL_DSN
	}

	dao.Init(dsn)
	ossOpt := dao.Option("oss")
	Endpoint, err = ossOpt.Get("endpoint")
	assertNoError(err)
	AccessKeyID, err = ossOpt.Get("access_key")
	assertNoError(err)
	AccessKeySecret, err = ossOpt.Get("access_secret")
	assertNoError(err)
	OSSBucket, err = ossOpt.Get("bucket_name")
	assertNoError(err)

	ce, err := cloudengine.NewAliOss(Endpoint, AccessKeyID, AccessKeySecret)
	if err != nil {
		log.Fatalln(err)
	}

	rs, err := api.NewRest(ce, OSSBucket)
	if err != nil {
		log.Fatalln(err)
	}

	if err := rs.Run(); err != nil {
		log.Fatal(err)
	}
}
