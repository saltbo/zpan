package bind

import (
	"github.com/saltbo/zpan/model"
)

type StorageBody struct {
	Name       string `json:"name"`
	Intro      string `json:"intro"`
	Bucket     string `json:"bucket"`
	Endpoint   string `json:"endpoint"`
	CustomHost string `json:"custom_host"`
	AccessKey  string `json:"access_key"`
	SecretKey  string `json:"secret_key"`
}

func (b *StorageBody) Model() *model.Storage {
	return &model.Storage{
		Name:       b.Name,
		Intro:      b.Intro,
		Bucket:     b.Bucket,
		Endpoint:   b.Endpoint,
		CustomHost: b.CustomHost,
		AccessKey:  b.AccessKey,
		SecretKey:  b.SecretKey,
	}
}

type StorageQuery struct {
	QueryPage
}
