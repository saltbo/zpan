package entity

import (
	"time"

	"gorm.io/gorm"
)

const (
	StorageModeNetDisk = iota + 1
	StorageModeOutline
)

const (
	StorageStatusEnabled = iota + 1
	StorageStatusDisabled
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
	Region     string         `json:"region" gorm:"size:128;default:auto;not null"`
	AccessKey  string         `json:"access_key" gorm:"size:64;not null"`
	SecretKey  string         `json:"secret_key" gorm:"size:64;not null"`
	CustomHost string         `json:"custom_host" gorm:"size:128;not null"`
	RootPath   string         `json:"root_path" gorm:"size:64;not null"`
	FilePath   string         `json:"file_path" gorm:"size:1024;not null"`
	Status     int8           `json:"status" gorm:"size:1;default:1;not null"`
	Created    time.Time      `json:"created" gorm:"->;<-:create;autoCreateTime;not null"`
	Updated    time.Time      `json:"updated" gorm:"autoUpdateTime;not null"`
	Deleted    gorm.DeletedAt `json:"-"`
}

func (s *Storage) GetID() int64 {
	return s.Id
}

func (s *Storage) TableName() string {
	return "zp_storage"
}

func (s *Storage) AfterFind(db *gorm.DB) error {
	s.SecretKey = s.SKAsterisk()
	return nil
}

func (s *Storage) PublicRead() bool {
	return s.Mode == StorageModeOutline
}

func (s *Storage) SKAsterisk() (sk string) {
	for range s.SecretKey {
		sk += "*"
	}
	return
}
