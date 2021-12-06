package provider

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/saltbo/gopkg/strutil"
	"github.com/upyun/go-sdk/v3/upyun"
)

// USSProvider 又拍云
type USSProvider struct {
	conf   *Config
	client *upyun.UpYun
}

func NewUSSProvider(conf *Config) (Provider, error) {
	return &USSProvider{
		conf: conf,
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

func (p *USSProvider) Head(object string) (*Object, error) {
	fi, err := p.client.GetInfo(object)
	if err != nil {
		return nil, err
	}

	return &Object{
		Key:  object,
		ETag: fi.MD5,
		Type: fi.ContentType,
	}, nil
}

func (p *USSProvider) SignedPutURL(key, filetype string, filesize int64, public bool) (url string, headers http.Header, err error) {
	// todo 新版签名存在跨域问题暂时不能用，客服反馈正在调试，后续通知。
	//expireAt := time.Now().Add(defaultUploadExp).Unix()
	//headers.Set("X-Upyun-Expire", fmt.Sprint(expireAt))
	//headers.Set("X-Upyun-Uri-Prefix", uriPrefix)

	//老版签名不能设置有效期，固定为30min
	headers = make(http.Header)
	date := time.Now().UTC().Format(http.TimeFormat)
	uri := fmt.Sprintf("/%s/%s", p.client.Bucket, urlEncode(key))
	headers.Set("X-Date", date)
	headers.Set("Authorization", p.buildOldSign("PUT", uri, date, fmt.Sprint(filesize)))
	return fmt.Sprintf("http://v0.api.upyun.com%s", uri), headers, err
}

func (p *USSProvider) SignedGetURL(key, filename string) (url string, err error) {
	expireAt := time.Now().Add(defaultDownloadExp).Unix()
	upd := urlEncode(filename)
	upt := p.buildUpt(expireAt, fmt.Sprintf("/%s", key))
	return fmt.Sprintf("%s?_upd=%s&_upt=%s", p.PublicURL(key), upd, upt), err
}

func (p *USSProvider) PublicURL(key string) (url string) {
	host := p.conf.CustomHost
	if host == "" {
		host = p.conf.Endpoint
	}

	if !strings.Contains(host, "://") {
		host = "http://" + host
	}

	return fmt.Sprintf("%s/%s", host, key)
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

func (p *USSProvider) HasMultipartSupport() bool {
	return false
}

func (p *USSProvider) CreateMultipartUpload(key, filetype string, public bool) (uid string, err error) {
	return "", fmt.Errorf("not realized")
}

func (p *USSProvider) CompleteMultipartUpload(key, uid string, parts []*ObjectPart) error {
	return fmt.Errorf("not realized")
}

func (p *USSProvider) SignedPartPutURL(key, uid string, partSize, partNumber int64) (string, http.Header, error) {
	return "", nil, fmt.Errorf("not realized")
}

func (p *USSProvider) buildSign(items ...string) string {
	mac := hmac.New(sha1.New, []byte(strutil.Md5Hex(p.conf.AccessSecret)))
	mac.Write([]byte(strings.Join(items, "&")))
	signStr := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("UpYun %s:%s", p.client.Operator, signStr)
}

func (p USSProvider) buildUpt(expireAt int64, uri string) string {
	// sign = MD5( secret & etime & URI )
	//_upt = sign { 中间 8 位 }＋etime
	signStr := strings.Join([]string{p.conf.AccessSecret, fmt.Sprint(expireAt), uri}, "&")
	return strutil.Md5Hex(signStr)[12:20] + fmt.Sprint(expireAt)
}

func (p *USSProvider) buildOldSign(items ...string) string {
	items = append(items, strutil.Md5Hex(p.conf.AccessSecret))
	signStr := strutil.Md5Hex(strings.Join(items, "&"))
	return fmt.Sprintf("UpYun %s:%s", p.client.Operator, signStr)
}
