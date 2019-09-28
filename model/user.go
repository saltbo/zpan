package model

import (
	"time"
)

type User struct {
	Id       int64     `json:"id"`
	Email    string    `json:"email"`
	Password string    `json:"password"`
	Nickname string    `json:"nickname"`
	Roles    string    `json:"roles"`
	Deleted  time.Time `json:"deleted" xorm:"deleted"`
	Created  time.Time `json:"created" xorm:"created"`
	Updated  time.Time `json:"updated" xorm:"updated"`
}
