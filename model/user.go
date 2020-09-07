package model

import (
	"time"
)

type User struct {
	Id          int64      `json:"id"`
	Ux          string     `json:"ux" gorm:"not null"`
	StorageUsed uint64     `json:"storage_used" gorm:"not null"`
	StorageMax  uint64     `json:"storage_max" gorm:"not null"`
	Created     time.Time  `json:"created" gorm:"column:created_at;not null"`
	Updated     time.Time  `json:"updated" gorm:"column:updated_at;not null"`
	Deleted     *time.Time `json:"-" gorm:"column:deleted_at"`
}

func (u *User) StorageOverflowed(addonSize int64) bool {
	if u.StorageUsed+uint64(addonSize) >= u.StorageMax {
		return true
	}

	return false
}
