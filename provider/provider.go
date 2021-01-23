package provider

import (
	"fmt"
	"net/http"
	"net/url"
)

var urlEncode = url.QueryEscape

var corsAllowHeaders = []string{"content-type", "content-disposition", "x-amz-acl"}

type Provider interface {
	SetupCORS() error
	SignedPutURL(key, filetype string, public bool) (url string, headers http.Header, err error)
	SignedGetURL(key, filename string) (url string, err error)
	PublicURL(key string) (url string)
	ObjectDelete(key string) error
	ObjectsDelete(keys []string) error
}

type Config struct {
	Provider     string
	Bucket       string
	Endpoint     string
	CustomHost   string
	AccessKey    string
	AccessSecret string
}

type Constructor func(provider Config) (Provider, error)

var supportProviders = map[string]Constructor{
	"s3":  NewS3Provider,
	"oss": NewAliOSSProvider,
	//"od": NewODProvider,
	//"gd": NewGDProvider,
}

func New(conf Config) (Provider, error) {
	constructor, ok := supportProviders[conf.Provider]
	if !ok {
		return nil, fmt.Errorf("provider %s not found", conf.Provider)
	}

	return constructor(conf)
}
