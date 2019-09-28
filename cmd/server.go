package main

import (
	"log"

	"zpan/api"
	"zpan/cloudengine"
)

var (
	Endpoint        string
	AccessKeyID     string
	AccessKeySecret string
	OSSBucket       string
)

func main() {
	Endpoint = "https://oss-cn-beijing.aliyuncs.com"
	AccessKeyID = "LTAI4FiknxYgApriwqwBXmS3"
	AccessKeySecret = "Vt1FZgXGOQ05RUVuAZ8TGvdKp380AI"
	OSSBucket = "saltbo"

	ce, err := cloudengine.NewAliOss(Endpoint, AccessKeyID, AccessKeySecret)
	if err != nil {
		log.Fatalln(err)
	}

	rs, err := api.NewRest(ce)
	if err != nil {
		log.Fatalln(err)
	}

	if err := rs.Run(); err != nil {
		log.Fatal(err)
	}
}
