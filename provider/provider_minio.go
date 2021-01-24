package provider

import (
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

// MinIO
type MINIOProvider struct {
	S3Provider

	client *oss.Client
}

func NewMINIOProvider(conf Config) (Provider, error) {
	p, err := newS3Provider(conf)
	if err != nil {
		return nil, err
	}

	return &MINIOProvider{
		S3Provider: *p,
	}, err
}

func (p *MINIOProvider) SetupCORS() error {
	// 没找到相关接口，好像是没有跨域限制？
	return nil
}
