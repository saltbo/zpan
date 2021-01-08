package bind

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/saltbo/gopkg/timeutil"

	"github.com/saltbo/zpan/model"
)

type QueryFiles struct {
	QueryPage
	Sid     int64  `form:"sid" binding:"required"`
	Dir     string `form:"dir"`
	Type    string `form:"type"`
	Keyword string `form:"kw"`
}

type BodyFile struct {
	Sid    int64  `json:"sid" binding:"required"`
	Name   string `json:"name" binding:"required"`
	Size   int64  `json:"size" binding:"required"`
	Type   string `json:"type"`
	Dir    string `json:"dir"`
	Public bool   `json:"public"`
}

func (p *BodyFile) ToMatter(uid int64) *model.Matter {
	if p.Type == "" {
		p.Type = "application/octet-stream"
	}
	m := model.NewMatter(uid, p.Sid, p.Name)
	m.Type = p.Type
	m.Size = p.Size
	m.Parent = p.Dir

	prefix := timeutil.Format(time.Now(), "YYYYMMDD")
	m.Object = fmt.Sprintf("%s/%s%s", prefix, m.Alias, filepath.Ext(p.Name))
	if p.Public {
		m.ACL = model.AclPublic
	}

	return m
}

type BodyFileRename struct {
	NewName string `json:"name" binding:"required"`
}

type BodyFileMove struct {
	NewDir string `json:"dir"`
}

type BodyFileCopy struct {
	NewPath string `json:"path" binding:"required"`
}
