package bind

import (
	"github.com/saltbo/zpan/internal/app/model"
)

type QueryFiles struct {
	QueryPage
	Sid     int64  `form:"sid" binding:"required"`
	Dir     string `form:"dir"`
	Type    string `form:"type"`
	Keyword string `form:"kw"`
}

type BodyMatter struct {
	Sid   int64  `json:"sid" binding:"required"`
	Name  string `json:"name" binding:"required"`
	IsDir bool   `json:"is_dir"`
	Dir   string `json:"dir"`
	Type  string `json:"type"`
	Size  int64  `json:"size"`
}

func (p *BodyMatter) ToMatter(uid int64) *model.Matter {
	m := model.NewMatter(uid, p.Sid, p.Name)
	m.Type = p.Type
	m.Size = p.Size
	m.Parent = p.Dir
	if p.IsDir {
		m.DirType = model.DirTypeUser
	} else if p.Type == "" {
		p.Type = "application/octet-stream"
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
