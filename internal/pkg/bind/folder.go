package bind

import (
	"github.com/saltbo/zpan/internal/app/model"
)

type QueryFolder struct {
	QueryPage

	Sid    int64  `form:"sid" binding:"required"`
	Parent string `form:"parent"`
}

type BodyFolder struct {
	Sid  int64  `json:"sid" binding:"required"`
	Name string `json:"name" binding:"required"`
	Dir  string `json:"dir"`
}

func (p *BodyFolder) ToMatter(uid int64) *model.Matter {
	m := model.NewMatter(uid, p.Sid, p.Name)
	m.Parent = p.Dir
	m.DirType = model.DirTypeUser
	return m
}
