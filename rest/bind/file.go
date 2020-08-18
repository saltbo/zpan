package bind

import "github.com/saltbo/zpan/model"

type QueryFiles struct {
	QueryPage
	Dir     string `form:"dir"`
	Type    string `form:"type"`
	Search  bool   `form:"search"`
	Keyword string `form:"keyword"`
}

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
	return m
}

type BodyFile struct {
	Uid    int64  `json:"uid"`
	Name   string `json:"name" binding:"required"`
	Type   string `json:"type" binding:"required"`
	Size   int64  `json:"size" binding:"required"`
	Dir    string `json:"dir"`
	Object string `json:"object" binding:"required"`
}

func (p *BodyFile) ToMatter() *model.Matter {
	m := model.NewMatter()
	m.Uid = p.Uid
	m.Name = p.Name
	m.Type = p.Type
	m.Size = p.Size
	m.Parent = p.Dir
	m.Object = p.Object
	return m
}

type BodyFileOperation struct {
	Alias  string `json:"alias" binding:"required"`
	Dest   string `json:"dest"`
	Action int64  `json:"action" binding:"required"`
}
