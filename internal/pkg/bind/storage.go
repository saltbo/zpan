package bind

import (
	"strings"

	"github.com/saltbo/zpan/internal/app/model"
)

var ts = strings.TrimSpace

type StorageBody struct {
	Mode       int8   `json:"mode" binding:"required"`
	Name       string `json:"name" binding:"required"`
	Bucket     string `json:"bucket" binding:"required"`
	Provider   string `json:"provider" binding:"required"`
	Endpoint   string `json:"endpoint" binding:"required"`
	Region     string `json:"region"`
	AccessKey  string `json:"access_key" binding:"required"`
	SecretKey  string `json:"secret_key" binding:"required"`
	Title      string `json:"title"`
	Status     int8   `json:"status"`
	IDirs      string `json:"idirs"` // internal dirs
	CustomHost string `json:"custom_host"`
	RootPath   string `json:"root_path"`
	FilePath   string `json:"file_path"`
	PublicRead bool   `json:"public_read"`
}

func (b *StorageBody) Model() *model.Storage {
	title := b.Title
	if title == "" {
		title = b.Name
	}

	return &model.Storage{
		Mode:       b.Mode,
		Name:       ts(b.Name),
		Title:      ts(title),
		IDirs:      ts(b.IDirs),
		Bucket:     ts(b.Bucket),
		Provider:   b.Provider,
		Endpoint:   ts(b.Endpoint),
		Region:     ts(b.Region),
		Status:     b.Status,
		CustomHost: ts(b.CustomHost),
		AccessKey:  ts(b.AccessKey),
		SecretKey:  ts(b.SecretKey),
		RootPath:   ts(b.RootPath),
		FilePath:   ts(b.FilePath),
	}
}

type StorageQuery struct {
	QueryPage

	Name string `json:"name"`
}
