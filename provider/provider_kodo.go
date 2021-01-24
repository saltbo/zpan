package provider

import (
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

// 七牛云
type KODOProvider struct {
	S3Provider

	client *oss.Client
}

func NewKODOProvider(conf Config) (Provider, error) {
	p, err := newS3Provider(conf)
	if err != nil {
		return nil, err
	}

	return &KODOProvider{
		S3Provider: *p,
	}, err
}

func (p *KODOProvider) SetupCORS() error {
	// 官方没有提供相关接口，但是兼容S3的接口
	return p.S3Provider.SetupCORS()
}
