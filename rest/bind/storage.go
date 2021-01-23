package bind

import (
	"github.com/saltbo/zpan/model"
)

type StorageBody struct {
	Mode       int8   `json:"mode"`
	Name       string `json:"name"`
	Title      string `json:"title"`
	Bucket     string `json:"bucket"`
	Endpoint   string `json:"endpoint"`
	CustomHost string `json:"custom_host"`
	AccessKey  string `json:"access_key"`
	SecretKey  string `json:"secret_key"`
}

func (b *StorageBody) Model() *model.Storage {
	return &model.Storage{
		Mode:       b.Mode,
		Name:       b.Name,
		Title:      b.Title,
		Bucket:     b.Bucket,
		Endpoint:   b.Endpoint,
		CustomHost: b.CustomHost,
		AccessKey:  b.AccessKey,
		SecretKey:  b.SecretKey,
	}
}

type StorageQuery struct {
	QueryPage

	Name string `json:"name"`
}
