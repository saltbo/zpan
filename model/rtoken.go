package model

import (
	"time"
)

type Rtoken struct {
	Id      int64     `json:"id"`
	Uid     int64     `json:"uid" xorm:"notnull"`
	Token   string    `json:"token" xorm:"notnull"`
	Deleted time.Time `json:"deleted" xorm:"notnull deleted"`
	Created time.Time `json:"created" xorm:"notnull created"`
	Updated time.Time `json:"updated" xorm:"notnull updated"`
}
