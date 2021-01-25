package bind

import (
	"strings"

	"github.com/saltbo/zpan/model"
)

var ts = strings.TrimSpace

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
	RootPath   string `json:"root_path"`
	FilePath   string `json:"file_path"`
	PublicRead bool   `json:"public_read"`
}

func (b *StorageBody) Model() *model.Storage {
	return &model.Storage{
		Mode:       b.Mode,
		Name:       ts(b.Name),
		Title:      ts(b.Title),
		Bucket:     ts(b.Bucket),
		Provider:   b.Provider,
		Endpoint:   ts(b.Endpoint),
		CustomHost: ts(b.CustomHost),
		AccessKey:  ts(b.AccessKey),
		SecretKey:  ts(b.SecretKey),
		RootPath:   ts(b.RootPath),
		FilePath:   ts(b.FilePath),
		PublicRead: b.PublicRead,
	}
}

type StorageQuery struct {
	QueryPage

	Name string `json:"name"`
}
