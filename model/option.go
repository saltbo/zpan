package model

import "time"

type Option struct {
	Id      int64                  `json:"id"`
	Name    string                 `json:"name"`
	Opts    map[string]interface{} `json:"opts"`
	Created time.Time              `json:"created" gorm:"column:created_at;not null"`
	Updated time.Time              `json:"updated" gorm:"column:updated_at;not null"`
	Deleted *time.Time             `json:"-" gorm:"column:deleted_at"`
}

func (Option) TableName() string {
	return "zp_option"
}
