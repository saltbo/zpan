package provider

import (
	"fmt"
	"net/http"
	"time"

	"github.com/upyun/go-sdk/v3/upyun"
)

// USSProvider 又拍云
type USSProvider struct {
	client *upyun.UpYun
}

func NewUSSProvider(conf *Config) (Provider, error) {
	return &USSProvider{
		client: upyun.NewUpYun(&upyun.UpYunConfig{
			Bucket:   conf.Bucket,
			Operator: conf.AccessKey,
			Password: conf.AccessSecret,
		}),
	}, nil
}

func (p *USSProvider) SetupCORS() error {
	// 官方没有提供相关接口，暂不实现
	return nil
}

func (p *USSProvider) SignedPutURL(key, filetype string, public bool) (url string, headers http.Header, err error) {
	// todo 完成token计算，参考https://help.upyun.com/knowledge-base/object_storage_authorization/

	headers = make(http.Header)
	expireAt := time.Now().Add(time.Minute).Unix()
	headers.Set("X-Upyun-Expire", fmt.Sprint(expireAt))
	headers.Set("X-Upyun-Uri-Prefix", fmt.Sprintf("%s/%s", p.client.Bucket, key))
	headers.Set("Content-Type", filetype)
	//headers.Set("Authorization", token)
	return fmt.Sprintf("http://v0.api.upyun.com/%s/%s", p.client.Bucket, key), headers, err
}

func (p *USSProvider) SignedGetURL(key, filename string) (url string, err error) {
	//_upt
	// todo 官方文档没找到相关实现，在Cloudreve里看到了_upt这个参数，可以参考实现
	return "", err
}

func (p *USSProvider) PublicURL(key string) (url string) {
	return fmt.Sprintf("http://v0.api.upyun.com/%s/%s", p.client.Bucket, key)
}

func (p *USSProvider) ObjectDelete(key string) error {
	return p.client.Delete(&upyun.DeleteObjectConfig{
		Path:   key,
		Async:  false,
		Folder: false,
	})
}

func (p *USSProvider) ObjectsDelete(keys []string) error {
	for _, key := range keys {
		err := p.ObjectDelete(key)
		if err != nil {
			return err
		}
	}

	return nil
}
