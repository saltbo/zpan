package bind

import (
	"github.com/saltbo/zpan/internal/app/entity"
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

func (p *BodyFolder) ToMatter(uid int64) *entity.Matter {
	m := entity.NewMatter(uid, p.Sid, p.Name)
	m.Parent = p.Dir
	m.DirType = entity.DirTypeUser
	return m
}
