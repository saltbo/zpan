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
	Dir     string `form:"dir"`
	Type    string `form:"type"`
	Keyword string `form:"kw"`
}

type BodyFile struct {
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
	m := model.NewMatter(uid, p.Name)
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
