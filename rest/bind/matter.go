package bind

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

type BodyFile struct {
	Uid    int64  `json:"uid"`
	Name   string `json:"name" binding:"required"`
	Type   string `json:"type" binding:"required"`
	Size   int64  `json:"size" binding:"required"`
	Dir    string `json:"dir"`
	Object string `json:"object" binding:"required"`
}

type BodyFileOperation struct {
	Id     int64  `json:"id" binding:"required"`
	Dest   string `json:"dest"`
	Action int64  `json:"action" binding:"required"`
}
