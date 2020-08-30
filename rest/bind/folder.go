package bind

import (
	"time"

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
	m := model.NewMatter()
	m.Uid = uid
	m.Name = p.Name
	m.Parent = p.Dir
	m.DirType = model.DirTypeUser
	m.Uploaded = time.Now()
	return m
}
