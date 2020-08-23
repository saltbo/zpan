package model

import (
	"time"

	"github.com/saltbo/gopkg/strutil"
)

const (
	DirTypeSys = iota + 1
	DirTypeUser
)

type Matter struct {
	Id      int64      `json:"id"`
	Uid     int64      `json:"uid" gorm:"not null"`
	Alias   string     `json:"alias" gorm:"not null"`
	Name    string     `json:"name" gorm:"not null"`
	Type    string     `json:"type" gorm:"not null"`
	Size    int64      `json:"size" gorm:"not null"`
	Object  string     `json:"object" gorm:"not null"`
	DirType int8       `json:"dirtype" gorm:"column:dirtype;not null"`
	Parent  string     `json:"parent" gorm:"not null"`
	Created time.Time  `json:"created" gorm:"column:created_at;not null"`
	Updated time.Time  `json:"updated" gorm:"column:updated_at;not null"`
	Deleted *time.Time `json:"-" gorm:"column:deleted_at"`
}

func NewMatter() *Matter {
	return &Matter{
		Alias: strutil.RandomText(32),
	}
}

func (Matter) TableName() string {
	return "matter"
}

func (m *Matter) Clone() *Matter {
	clone := *m
	return &clone
}

func (m *Matter) IsDir() bool {
	return m.DirType > 0
}
