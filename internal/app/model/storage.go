package model

import (
	"time"

	"gorm.io/gorm"
)

const (
	StorageModeNetDisk = iota + 1
	StorageModeFileDisk
)

type Storage struct {
	Id         int64          `json:"id"`
	Mode       int8           `json:"mode" gorm:"size:16;not null"`
	Name       string         `json:"name" gorm:"size:16;not null"`
	Title      string         `json:"title" gorm:"size:16;not null"`
	IDirs      string         `json:"idirs" gorm:"size:255;not null"` // internal dirs
	Bucket     string         `json:"bucket" gorm:"size:32;not null"`
	Provider   string         `json:"provider" gorm:"size:8;not null"`
	Endpoint   string         `json:"endpoint" gorm:"size:128;not null"`
	Region     string         `json:"region" gorm:"size:128;not null"`
	AccessKey  string         `json:"access_key" gorm:"size:64;not null"`
	SecretKey  string         `json:"secret_key" gorm:"size:64;not null"`
	CustomHost string         `json:"custom_host" gorm:"size:128;not null"`
	RootPath   string         `json:"root_path" gorm:"size:64;not null"`
	FilePath   string         `json:"file_path" gorm:"size:1024;not null"`
	Created    time.Time      `json:"created" gorm:"autoCreateTime;not null"`
	Updated    time.Time      `json:"updated" gorm:"autoUpdateTime;not null"`
	Deleted    gorm.DeletedAt `json:"-"`
}

func (Storage) TableName() string {
	return "zp_storage"
}

func (s *Storage) PublicRead() bool {
	return s.Mode == StorageModeFileDisk
}

func (s *Storage) SKAsterisk() (sk string) {
	for range s.SecretKey {
		sk += "*"
	}
	return
}
