package disk

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
)

var urlEncode = url.QueryEscape

type Provider interface {
	SignedPutURL(key, filetype string, public bool) (url string, headers http.Header, err error)
	SignedGetURL(key, filename string) (url string, err error)
	PublicURL(key string) (url string)
	ObjectDelete(key string) error
	ObjectsDelete(keys []string) error
}

type Config struct {
	Name         string
	Bucket       string
	Endpoint     string
	CustomHost   string
	AccessKey    string
	AccessSecret string
}

type ProviderConstructor func(provider Config) (Provider, error)

var supportDrivers = map[string]string{
	"cos":  "cos.(.*).myqcloud.com",
	"oss":  `oss.(.*).aliyuncs.com`,
	"kodo": "s3-(.*).qiniucs.com",
}

func New(conf Config) (Provider, error) {
	expr, ok := supportDrivers[conf.Name]
	if !ok {
		return nil, fmt.Errorf("provider %s not found", conf.Name)
	}

	exp, err := regexp.Compile(expr)
	if err != nil {
		return nil, err
	}

	return newAwsS3(conf, exp.FindString(conf.Endpoint))
}
