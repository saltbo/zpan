package provider

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
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

func (p *USSProvider) List(prefix string) ([]Object, error) {
	panic("implement me")
}

func (p *USSProvider) Move(object, newObject string) error {
	panic("implement me")
}

func (p *USSProvider) SignedPutURL(key, filetype string, public bool) (url string, headers http.Header, err error) {
	headers = make(http.Header)
	expireAt := time.Now().Add(time.Minute * 15).Unix()
	uriPrefix := fmt.Sprintf("/%s/%s", p.client.Bucket,  strings.TrimSuffix(key, filepath.Ext(key)))
	headers.Set("X-Upyun-Expire", fmt.Sprint(expireAt))
	headers.Set("X-Upyun-Uri-Prefix", uriPrefix)
	headers.Set("Content-Type", filetype)
	headers.Set("Authorization", p.buildSign("PUT", uriPrefix, fmt.Sprint(expireAt)))
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

func (p *USSProvider) buildSign(items ...string) string {
	mac := hmac.New(sha1.New, []byte(p.client.Password))
	mac.Write([]byte(strings.Join(items, "&")))
	signStr := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("UPYUN %s:%s", p.client.Operator, signStr)
}
