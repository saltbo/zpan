package model

import (
	"time"
)

type Share struct {
	Id        int64     `json:"id"`
	Uid       int64     `json:"uid" xorm:"notnull"`
	Alias     string    `json:"alias" xorm:"varchar(16) notnull"`
	Secret    string    `json:"secret" xorm:"varchar(16) notnull"`
	RawUri    string    `json:"raw_uri" xorm:"varchar(255) notnull"`
	DownTimes int64     `json:"down_times" xorm:"notnull"`
	ViewTimes int64     `json:"view_times" xorm:"notnull"`
	Deleted   time.Time `json:"deleted" xorm:"notnull deleted"`
	Created   time.Time `json:"created" xorm:"notnull created"`
	Updated   time.Time `json:"updated" xorm:"notnull updated"`
}
