package provider

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
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
	Region       string
	CustomHost   string
	AccessKey    string
	AccessSecret string
}

type Constructor func(provider Config) (Provider, error)

var supportProviders = map[string]Constructor{
	"COS":   NewCOSProvider,
	"KODO":  NewKODOProvider,
	"MINIO": NewMINIOProvider,
	"NOS":   NewNOSProvider,
	"OBS":   NewOBSProvider,
	"OSS":   NewOSSProvider,
	"S3":    NewS3Provider,
	"US3":   NewUS3Provider,
	//"USS":   NewUSSProvider,
	//"od": NewODProvider,
	//"gd": NewGDProvider,
}

func New(conf Config) (Provider, error) {
	if conf.Region == "" {
		conf.Region = "auto"
	}

	if !strings.Contains(conf.CustomHost, "://") {
		conf.CustomHost = "http://" + conf.CustomHost
	}

	constructor, ok := supportProviders[strings.ToUpper(conf.Provider)]
	if !ok {
		return nil, fmt.Errorf("provider %s not found", conf.Provider)
	}

	return constructor(conf)
}

func GetProviders() []string {
	keys := make([]string, 0)
	for k := range supportProviders {
		keys = append(keys, k)
	}

	return keys
}
