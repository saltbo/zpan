package provider

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/tencentyun/cos-go-sdk-v5"
)

// 腾讯云
type COSProvider struct {
	S3Provider

	client *cos.Client
}

func NewCOSProvider(conf Config) (Provider, error) {
	p, err := newS3Provider(conf)
	if err != nil {
		return nil, err
	}

	u, err := url.Parse(fmt.Sprintf("https://%s.%s", conf.Bucket, conf.Endpoint))
	if err != nil {
		return nil, err
	}

	httpClient := &http.Client{
		Timeout: 100 * time.Second,
		Transport: &cos.AuthorizationTransport{
			SecretID:  conf.AccessKey,
			SecretKey: conf.AccessSecret,
		},
	}

	return &COSProvider{
		S3Provider: *p,

		client: cos.NewClient(&cos.BaseURL{BucketURL: u}, httpClient),
	}, err
}

func (p *COSProvider) SetupCORS() error {
	ctx := context.Background()
	ret, _, err := p.client.Bucket.GetCORS(ctx)
	if err != nil {
		return err
	}

	zRule := cos.BucketCORSRule{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"PUT"},
		AllowedHeaders: corsAllowHeaders,
		MaxAgeSeconds:  300,
	}
	_, err = p.client.Bucket.PutCORS(ctx, &cos.BucketPutCORSOptions{Rules: append(ret.Rules, zRule)})
	return err
}
