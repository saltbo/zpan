package model

import (
	"time"
)

type Matter struct {
	Id      int64     `json:"id"`
	Uid     int64     `json:"uid" gorm:"not null"`
	Name    string    `json:"name" gorm:"not null"`
	Type    string    `json:"type" gorm:"not null"`
	Size    int64     `json:"size" gorm:"not null"`
	Object  string    `json:"object" gorm:"not null"`
	Dirtype int8      `json:"dirtype" gorm:"not null"`
	Parent  string    `json:"parent" gorm:"not null"`
	Deleted time.Time `json:"deleted" gorm:"column:deleted_at;not null"`
	Created time.Time `json:"created" gorm:"column:created_at;not null"`
	Updated time.Time `json:"updated" gorm:"column:updated_at;not null"`
}

func (Matter) TableName() string {
	return "matter"
}
