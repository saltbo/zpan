package model

import (
	"time"
)

type Matter struct {
	Id      int64     `json:"id"`
	Uid     int64     `json:"uid" xorm:"notnull"`
	Name    string    `json:"name" xorm:"notnull"`
	Type    string    `json:"type" xorm:"notnull"`
	Size    int64     `json:"size" xorm:"notnull"`
	Object  string    `json:"object" xorm:"notnull"`
	Dir     bool      `json:"dir" xorm:"notnull"`
	Parent  string    `json:"parent" xorm:"notnull"`
	Deleted time.Time `json:"deleted" xorm:"notnull deleted"`
	Created time.Time `json:"created" xorm:"notnull created"`
	Updated time.Time `json:"updated" xorm:"notnull updated"`
}
