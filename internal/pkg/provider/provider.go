package provider

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var urlEncode = url.QueryEscape

var corsAllowHeaders = []string{"content-type", "content-disposition", "x-amz-acl"}

const (
	defaultUploadExp   = time.Hour
	defaultDownloadExp = time.Hour * 24
)

// Object is the basic operation unit
type Object struct {
	Key      string // remote file path
	ETag     string // file md5
	FilePath string // local file path
	Type     string // local file type, added or changed
}

type Provider interface {
	SetupCORS() error
	Head(object string) (*Object, error)
	List(prefix string) ([]Object, error)
	Move(object, newObject string) error
	SignedPutURL(key, filetype string, filesize int64, public bool) (url string, headers http.Header, err error)
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

func (c *Config) Clone() *Config {
	clone := *c
	return &clone
}

func (c *Config) WithCustomHost(s string) *Config {
	c.CustomHost = s
	return c
}

type Constructor func(provider *Config) (Provider, error)

var supportProviders = map[string]Constructor{
	"COS":   NewCOSProvider,
	"KODO":  NewKODOProvider,
	"MINIO": NewMINIOProvider,
	"NOS":   NewNOSProvider,
	"OBS":   NewOBSProvider,
	"OSS":   NewOSSProvider,
	"S3":    NewS3Provider,
	"US3":   NewUS3Provider,
	"USS":   NewUSSProvider,
	//"od": NewODProvider,
	//"gd": NewGDProvider,
}

func New(conf *Config) (Provider, error) {
	if conf.Region == "" {
		conf.Region = "auto"
	}

	if conf.CustomHost != "" && !strings.Contains(conf.CustomHost, "://") {
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
