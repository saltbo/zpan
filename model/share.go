package model

import (
	"time"
)

type Share struct {
	Id        int64      `json:"id"`
	Uid       int64      `json:"uid" gorm:"not null"`
	Alias     string     `json:"alias" gorm:"size:16;not null"`
	Matter    string     `json:"matter" gorm:"not null"`
	Name      string     `json:"name" gorm:"not null"`
	Type      string     `json:"type" gorm:"not null"`
	Secret    string     `json:"secret,omitempty" gorm:"size:16;not null"`
	Protected bool       `json:"protected" gorm:"-"`
	DownTimes int64      `json:"down_times" gorm:"not null"`
	ViewTimes int64      `json:"view_times" gorm:"not null"`
	ExpireAt  time.Time  `json:"expire_at" gorm:"column:expire_at;not null"`
	Created   time.Time  `json:"created" gorm:"column:created_at;not null"`
	Updated   time.Time  `json:"updated" gorm:"column:updated_at;not null"`
	Deleted   *time.Time `json:"-" gorm:"column:deleted_at"`
}

func (Share) TableName() string {
	return "zp_share"
}

func (s *Share) AfterFind() (err error) {
	s.Protected = s.Secret != ""
	return
}
