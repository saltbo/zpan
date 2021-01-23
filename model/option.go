package model

import "time"

type Opt struct {
	Key string `json:"key"`
	Val string `json:"val"`
}

type Option struct {
	Id      int64      `json:"id"`
	Name    string     `json:"name"`
	Opts    []Opt      `json:"opts"`
	Created time.Time  `json:"created" gorm:"column:created_at;not null"`
	Updated time.Time  `json:"updated" gorm:"column:updated_at;not null"`
	Deleted *time.Time `json:"-" gorm:"column:deleted_at"`
}

func (Option) TableName() string {
	return "zp_option"
}

var opts = map[string]OptI{
	"core": &OptCore{},
}

func FindOptResult(name string) OptI {
	return opts[name]
}

type OptI interface {
}

type OptCore struct {
	Title       string `json:"title"`
	Intro       string `json:"intro"`
	DefaultLang string `json:"default_lang"`
}
