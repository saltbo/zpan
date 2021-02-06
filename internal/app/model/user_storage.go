package model

import "time"

const (
	UserStorageDefaultSize = 50 << 20
	UserStorageActiveSize  = 1024 << 20
)

type UserStorage struct {
	Id      int64      `json:"id"`
	Uid     int64      `json:"uid" gorm:"not null"`
	Max     uint64     `json:"max" gorm:"not null"`
	Used    uint64     `json:"used" gorm:"not null"`
	Created time.Time  `json:"created" gorm:"column:created_at;not null"`
	Updated time.Time  `json:"updated" gorm:"column:updated_at;not null"`
	Deleted *time.Time `json:"-" gorm:"column:deleted_at"`
}

func (UserStorage) TableName() string {
	return "zp_storage_quota"
}

func (sq *UserStorage) Overflowed(addonSize int64) bool {
	if sq.Used+uint64(addonSize) >= sq.Max {
		return true
	}

	return false
}
