package provider

import (
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

// US3Provider UCloud
type US3Provider struct {
	S3Provider

	client *oss.Client
}

func NewUS3Provider(conf Config) (Provider, error) {
	p, err := newS3Provider(conf)
	if err != nil {
		return nil, err
	}

	return &US3Provider{
		S3Provider: *p,
	}, err
}

func (p *US3Provider) SetupCORS() error {
	// 官方没有提供相关接口，暂不实现
	return nil
}
