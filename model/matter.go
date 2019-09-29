package model

import (
	"time"
)

type Matter struct {
	Id       int64     `json:"id"`
	Uid      int64     `json:"uid" xorm:"notnull"`
	Dir      bool      `json:"dir" xorm:"notnull"`
	Name     string    `json:"name" xorm:"notnull"`
	Path     string    `json:"path" xorm:"notnull"`
	Type     string    `json:"type" xorm:"notnull"`
	Size     int64     `json:"size" xorm:"notnull"`
	ParentId int64     `json:"parent_id" xorm:"notnull"`
	Deleted  time.Time `json:"deleted" xorm:"notnull deleted"`
	Created  time.Time `json:"created" xorm:"notnull created"`
	Updated  time.Time `json:"updated" xorm:"notnull updated"`
}
