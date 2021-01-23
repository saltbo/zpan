package provider

import (
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

type AliOSSProvider struct {
	S3Provider

	client *oss.Client
}

func NewAliOSSProvider(conf Config) (Provider, error) {
	client, err := oss.New(conf.Endpoint, conf.AccessKey, conf.AccessSecret)
	if err != nil {
		return nil, err
	}

	p, err := newS3Provider(conf)
	if err != nil {
		return nil, err
	}

	return &AliOSSProvider{
		S3Provider: *p,

		client: client,
	}, err
}

func (p *AliOSSProvider) SetupCORS() error {
	rule := oss.CORSRule{
		AllowedOrigin: []string{"*"},
		AllowedMethod: []string{"PUT"},
		AllowedHeader: corsAllowHeaders,
		MaxAgeSeconds: 300,
	}
	return p.client.SetBucketCORS(p.bucket, []oss.CORSRule{rule})
}
