package main

import (
	"log"

	"zpan/api"
	"zpan/cloudengine"
	"zpan/dao"
)

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
	dao.Init("root:root@tcp(127.0.0.1:3306)/zpan?charset=utf8&interpolateParams=true")
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
