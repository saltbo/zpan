package disk

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
)

var urlEncode = url.QueryEscape

type Provider interface {
	PutPreSign(key, filetype string) (url string, headers http.Header, err error)
	GetPreSign(key, filename string) (url string, err error)
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

func New(provider Config) (Provider, error) {
	expr, ok := supportDrivers[provider.Name]
	if !ok {
		return nil, fmt.Errorf("provider %s not found", provider.Name)
	}

	exp, err := regexp.Compile(expr)
	if err != nil {
		return nil, err
	}

	return newAwsS3(provider, exp.FindString(provider.Endpoint))
}
