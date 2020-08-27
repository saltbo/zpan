package disk

import (
	"fmt"
)

type Provider interface {
	SetLifecycle(bucketName string) error
	BuildCallback(url, body string) string
	UploadURL(filename, objectKey, contentType, callback string, publicRead bool) (url string, headers map[string]string, err error)
	DownloadURL(objectKey string) (url string, err error)
	ObjectRename(objectKey, filename string) error
	ObjectSoftDel(objectKey string) error
	ObjectDelete(objectKey string) error
	ObjectsDelete(objectKeys []string) error
}

type Config struct {
	Name         string
	Bucket       string
	Endpoint     string
	CustomHost   string
	AccessKey    string
	AccessSecret string
}

type ProviderConstructor func(provider Config) (*AliOss, error)

var providerConstructors = map[string]ProviderConstructor{
	"ali-oss": newAliOss,
}

func New(provider Config) (Provider, error) {
	if providerConstructor, ok := providerConstructors[provider.Name]; ok {
		return providerConstructor(provider)
	}

	return nil, fmt.Errorf("provider %s not found", provider.Name)
}
