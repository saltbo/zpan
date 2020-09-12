package bind

import (
	"github.com/saltbo/zpan/model"
)

type QueryFolder struct {
	QueryPage
	Parent string `form:"parent"`
}

type BodyFolder struct {
	Name string `json:"name" binding:"required"`
	Dir  string `json:"dir"`
}

func (p *BodyFolder) ToMatter(uid int64) *model.Matter {
	m := model.NewMatter(uid, p.Name)
	m.Parent = p.Dir
	m.DirType = model.DirTypeUser
	return m
}
