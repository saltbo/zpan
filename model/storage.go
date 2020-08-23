package model

import (
	"time"
)

type Storage struct {
	Id      int64      `json:"id"`
	UserId  int64      `json:"user_id" gorm:"not null"`
	Max     uint64     `json:"max" gorm:"not null"`
	Used    uint64     `json:"used" gorm:"not null"`
	Created time.Time  `json:"created" gorm:"column:created_at;not null"`
	Updated time.Time  `json:"updated" gorm:"column:updated_at;not null"`
	Deleted *time.Time `json:"-" gorm:"column:deleted_at"`
}

func (Storage) TableName() string {
	return "storage"
}
