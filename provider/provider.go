package provider

import (
	"fmt"
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
	Name             string
	Bucket           string
	Endpoint         string
	CustomHost       string
	CustomPublicPath string
	AccessKey        string
	AccessSecret     string
}

type Constructor func(provider Config) (Provider, error)

var supportProviders = map[string]Constructor{
	"s3": NewS3Provider,
	//"od": NewODProvider,
	//"gd": NewGDProvider,
}

func New(conf Config) (Provider, error) {
	constructor, ok := supportProviders[conf.Name]
	if !ok {
		return nil, fmt.Errorf("provider %s not found", conf.Name)
	}

	return constructor(conf)
}
