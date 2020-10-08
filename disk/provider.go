package disk

import (
	"net/http"
	"net/url"
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

func New(conf Config) (Provider, error) {
	//if conf.Name == "onedrive" {
	//	return newOneDrive(conf)
	//}

	return newAwsS3(conf)
}
