package entity

import (
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/saltbo/gopkg/strutil"
	"gorm.io/gorm"
)

var DocTypes = []string{
	"text/csv",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

const (
	DirTypeSys = iota + 1
	DirTypeUser
	DirFileMaxNum = 65534
)

type Matter struct {
	Id         int64          `json:"id"`
	Uid        int64          `json:"uid" gorm:"not null"`
	Sid        int64          `json:"sid" gorm:"not null"` // storage_id
	Alias      string         `json:"alias" gorm:"size:16;not null"`
	Name       string         `json:"name" gorm:"not null"`
	Type       string         `json:"type" gorm:"not null"`
	Size       int64          `json:"size" gorm:"not null"`
	DirType    int8           `json:"dirtype" gorm:"column:dirtype;not null"`
	Parent     string         `json:"parent" gorm:"not null"`
	Object     string         `json:"object" gorm:"not null"`
	URL        string         `json:"url" gorm:"-"`
	Uploader   map[string]any `json:"uploader" gorm:"-"`
	UploadedAt *time.Time     `json:"uploaded"`
	CreatedAt  time.Time      `json:"created" gorm:"not null"`
	UpdatedAt  time.Time      `json:"updated" gorm:"not null"`
	DeletedAt  gorm.DeletedAt `json:"-"`
	TrashedBy  string         `json:"-" gorm:"size:16;not null"`
}

func (m *Matter) GetID() int64 {
	return m.Id
}

func NewMatter(uid, sid int64, name string) *Matter {
	return &Matter{
		Uid:      uid,
		Sid:      sid,
		Alias:    strutil.RandomText(16),
		Name:     strings.TrimSpace(name),
		Uploader: make(map[string]any),
	}
}

func (m *Matter) TableName() string {
	return "zp_matter"
}

func (m *Matter) Clone() *Matter {
	clone := *m
	clone.Id = 0
	clone.Alias = strutil.RandomText(16)
	return &clone
}

func (m *Matter) FullPath() string {
	fp := path.Join(m.Parent, m.Name)
	if m.IsDir() {
		fp += "/"
	}

	return fp
}

func (m *Matter) IsDir() bool {
	return m.DirType > 0
}

func (m *Matter) UserAccessible(uid int64) bool {
	return m.Uid == uid
}

func (m *Matter) BuildObject(rootPath string, filePath string) {
	if filePath == "" {
		filePath = "$NOW_DATE/$RAND_16KEY.$RAW_EXT"
	}

	m.Object = filepath.Join(rootPath, m.renderPath(filePath))
}

func (m *Matter) renderPath(path string) string {
	ons := make([]string, 0)
	for _, env := range SupportEnvs {
		ons = append(ons, env.Name, env.buildV(m))
	}

	return strings.NewReplacer(ons...).Replace(path)
}

func (m *Matter) BuildRecycleBinItem() *RecycleBin {
	return &RecycleBin{
		Uid:     m.Uid,
		Sid:     m.Sid,
		Mid:     m.Id,
		Alias:   strutil.RandomText(16),
		Name:    m.Name,
		Type:    m.Type,
		Size:    m.Size,
		DirType: m.DirType,
	}
}
