package provider

import (
	"github.com/saltbo/zpan/pkg/obs"
)

// 华为云
type OBSProvider struct {
	S3Provider

	client *obs.ObsClient
}

func NewOBSProvider(conf Config) (Provider, error) {
	client, err := obs.New(conf.AccessKey, conf.AccessSecret, conf.Endpoint)
	if err != nil {
		return nil, err
	}

	p, err := newS3Provider(conf)
	if err != nil {
		return nil, err
	}

	return &OBSProvider{
		S3Provider: *p,

		client: client,
	}, err
}

func (p *OBSProvider) SetupCORS() error {
	var existRules []obs.CorsRule
	ret, _ := p.client.GetBucketCors(p.bucket)
	if ret != nil && len(ret.CorsRules) > 0 {
		existRules = append(existRules, ret.CorsRules...)
	}

	zRule := obs.CorsRule{
		AllowedOrigin: []string{"*"},
		AllowedMethod: []string{"PUT"},
		AllowedHeader: corsAllowHeaders,
		MaxAgeSeconds: 300,
	}
	input := &obs.SetBucketCorsInput{
		Bucket:     p.bucket,
		BucketCors: obs.BucketCors{CorsRules: append(existRules, zRule)},
	}
	_, err := p.client.SetBucketCors(input)
	return err
}
