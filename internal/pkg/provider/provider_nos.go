package provider

import (
	"github.com/NetEase-Object-Storage/nos-golang-sdk/config"
	"github.com/NetEase-Object-Storage/nos-golang-sdk/nosclient"
)

// NOSProvider 网易云
type NOSProvider struct {
	S3Provider

	client *nosclient.NosClient
}

func NewNOSProvider(conf *Config) (Provider, error) {
	cfg := &config.Config{
		Endpoint:                    conf.Endpoint,
		AccessKey:                   conf.AccessKey,
		SecretKey:                   conf.AccessSecret,
		NosServiceConnectTimeout:    3,
		NosServiceReadWriteTimeout:  10,
		NosServiceMaxIdleConnection: 100,
	}
	client, err := nosclient.New(cfg)
	if err != nil {
		return nil, err
	}

	p, err := newS3Provider(conf)
	if err != nil {
		return nil, err
	}

	return &NOSProvider{
		S3Provider: *p,

		client: client,
	}, err
}

func (p *NOSProvider) SetupCORS() error {
	// p.client.
	// 官方的sdk里没有相关方法，暂不实现
	// todo 查询官方的API文档发现是有CORS相关接口的，可以给官方提交个PR
	return nil
}
