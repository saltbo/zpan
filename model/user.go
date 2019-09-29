package model

import (
	"time"
)

type User struct {
	Id          int64     `json:"id"`
	Email       string    `json:"email" xorm:"varchar(32) notnull"`
	Password    string    `json:"password" xorm:"varchar(64) notnull"`
	Nickname    string    `json:"nickname" xorm:"varchar(32) notnull"`
	Avatar      string    `json:"avatar" xorm:"varchar(255) notnull"`
	Roles       string    `json:"roles" xorm:"varchar(64) notnull"`
	StorageMax  uint64    `json:"storage_max" xorm:"notnull"`
	StorageUsed uint64    `json:"storage_used" xorm:"notnull"`
	Deleted     time.Time `json:"deleted" xorm:"notnull deleted"`
	Created     time.Time `json:"created" xorm:"notnull created"`
	Updated     time.Time `json:"updated" xorm:"notnull updated"`
}
