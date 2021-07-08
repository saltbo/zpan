package provider

import (
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

// OSSProvider 阿里云
type OSSProvider struct {
	S3Provider

	client *oss.Client
}

func NewOSSProvider(conf *Config) (Provider, error) {
	client, err := oss.New(conf.Endpoint, conf.AccessKey, conf.AccessSecret)
	if err != nil {
		return nil, err
	}

	p, err := newS3Provider(conf)
	if err != nil {
		return nil, err
	}

	return &OSSProvider{
		S3Provider: *p,

		client: client,
	}, err
}

func (p *OSSProvider) SetupCORS() error {
	var existRules []oss.CORSRule
	ret, _ := p.client.GetBucketCORS(p.bucket)
	if len(ret.CORSRules) > 0 {
		existRules = append(existRules, ret.CORSRules...)
	}

	zRule := oss.CORSRule{
		AllowedOrigin: []string{"*"},
		AllowedMethod: []string{"PUT"},
		AllowedHeader: corsAllowHeaders,
		MaxAgeSeconds: 300,
	}
	return p.client.SetBucketCORS(p.bucket, append(existRules, zRule))
}
