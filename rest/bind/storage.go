package bind

import (
	"strings"

	"github.com/saltbo/zpan/model"
)

type StorageBody struct {
	Mode       int8   `json:"mode" binding:"required"`
	Name       string `json:"name" binding:"required"`
	Title      string `json:"title" binding:"required"`
	Bucket     string `json:"bucket" binding:"required"`
	Provider   string `json:"provider" binding:"required"`
	Endpoint   string `json:"endpoint" binding:"required"`
	AccessKey  string `json:"access_key" binding:"required"`
	SecretKey  string `json:"secret_key" binding:"required"`
	CustomHost string `json:"custom_host"`
}

func (b *StorageBody) Model() *model.Storage {
	return &model.Storage{
		Mode:       b.Mode,
		Name:       strings.TrimSpace(b.Name),
		Title:      strings.TrimSpace(b.Title),
		Bucket:     strings.TrimSpace(b.Bucket),
		Provider:   b.Provider,
		Endpoint:   strings.TrimSpace(b.Endpoint),
		CustomHost: strings.TrimSpace(b.CustomHost),
		AccessKey:  strings.TrimSpace(b.AccessKey),
		SecretKey:  strings.TrimSpace(b.SecretKey),
	}
}

type StorageQuery struct {
	QueryPage

	Name string `json:"name"`
}
