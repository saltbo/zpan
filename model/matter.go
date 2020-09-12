package model

import (
	"time"

	"github.com/saltbo/gopkg/strutil"
)

const (
	DirTypeSys = iota + 1
	DirTypeUser
)

const (
	AclPublic    = "public"
	AclProtected = "protected"
)

type Matter struct {
	Id         int64      `json:"id"`
	Uid        int64      `json:"uid" gorm:"not null"`
	Alias      string     `json:"alias" gorm:"not null"`
	Name       string     `json:"name" gorm:"not null"`
	Type       string     `json:"type" gorm:"not null"`
	Size       int64      `json:"size" gorm:"not null"`
	DirType    int8       `json:"dirtype" gorm:"column:dirtype;not null"`
	Parent     string     `json:"parent" gorm:"not null"`
	Object     string     `json:"object" gorm:"not null"`
	ACL        string     `json:"acl" gorm:"not null"`
	URL        string     `json:"url" gorm:"-"`
	CreatedAt  time.Time  `json:"created" gorm:"not null"`
	UpdatedAt  time.Time  `json:"updated" gorm:"not null"`
	UploadedAt *time.Time `json:"uploaded"`
	DeletedAt  *time.Time `json:"-"`
}

func NewMatter(uid int64, name string) *Matter {
	return &Matter{
		Uid:   uid,
		Alias: strutil.RandomText(16),
		Name:  name,
		ACL:   AclProtected,
	}
}

func (Matter) TableName() string {
	return "zp_matter"
}

func (m *Matter) Clone() *Matter {
	clone := *m
	return &clone
}

func (m *Matter) IsDir() bool {
	return m.DirType > 0
}

func (m *Matter) Public() bool {
	return m.ACL == AclPublic
}

func (m *Matter) SetURL(fc func(object string) string) {
	if m.Public() {
		m.URL = fc(m.Object)
	}
}
