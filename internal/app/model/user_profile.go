package model

import (
	"time"
)

type UserProfile struct {
	Id       int64      `json:"id"`
	Uid      int64      `json:"uid" gorm:"unique_index;not null"`
	Nickname string     `json:"nickname" gorm:"size:32;not null"`
	Avatar   string     `json:"avatar" gorm:"size:255;not null"`
	Bio      string     `json:"bio" gorm:"size:255;not null"`
	URL      string     `json:"url" gorm:"size:255;not null"`
	Company  string     `json:"company" gorm:"size:32;not null"`
	Location string     `json:"location" gorm:"size:32;not null"`
	Locale   string     `json:"locale" gorm:"not null"`
	Deleted  *time.Time `json:"-" gorm:"column:deleted_at"`
	Created  time.Time  `json:"created" gorm:"column:created_at;not null"`
	Updated  time.Time  `json:"updated" gorm:"column:updated_at;not null"`
}

func (UserProfile) TableName() string {
	return "mu_user_profile"
}
