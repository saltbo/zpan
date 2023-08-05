package entity

import (
	"time"

	"gorm.io/gorm"
)

const (
	UserStorageDefaultSize = 50 << 20
	UserStorageActiveSize  = 1024 << 20
)

type UserStorage struct {
	Id      int64          `json:"id"`
	Uid     int64          `json:"uid" gorm:"not null"`
	Max     uint64         `json:"max" gorm:"not null"`
	Used    uint64         `json:"used" gorm:"not null"`
	Created time.Time      `json:"created" gorm:"autoCreateTime;not null"`
	Updated time.Time      `json:"updated" gorm:"autoUpdateTime;not null"`
	Deleted gorm.DeletedAt `json:"-"`
}

func (us *UserStorage) TableName() string {
	return "zp_storage_quota"
}

func (us *UserStorage) Overflowed(addonSize int64) bool {
	if us.Used+uint64(addonSize) >= us.Max {
		return true
	}

	return false
}
