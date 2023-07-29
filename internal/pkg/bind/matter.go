package bind

import (
	"mime"
	"path/filepath"

	"github.com/saltbo/zpan/internal/app/entity"
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

func (p *BodyMatter) ToMatter(uid int64) *entity.Matter {
	detectType := func(name string) string {
		cType := mime.TypeByExtension(filepath.Ext(p.Name))
		if cType != "" {
			return cType
		}

		return "application/octet-stream"
	}

	m := entity.NewMatter(uid, p.Sid, p.Name)
	m.Type = p.Type
	m.Size = p.Size
	m.Parent = p.Dir
	if p.IsDir {
		m.DirType = entity.DirTypeUser
	} else if p.Type == "" {
		m.Type = detectType(p.Name)
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
