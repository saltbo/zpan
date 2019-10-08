package api

type QueryPage struct {
	Offset int `form:"offset"`
	Limit  int `form:"limit"`
}

type QueryUser struct {
	QueryPage
	Name string `form:"name"`
}

type QueryFiles struct {
	QueryPage
	Path string `form:"path"`
	Type string `form:"type"`
}

type BodyUser struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type QueryMatter struct {
	Object string `form:"object" binding:"required"`
	Type   string `form:"type" binding:"required"`
	Size   int64  `form:"size" binding:"exists"`
	Parent string `form:"parent" binding:"exists"`
}

type BodyMatter struct {
	Uid    int64  `json:"uid"`
	Path   string `json:"path" binding:"required"`
	Type   string `json:"type" binding:"exists"`
	Size   int64  `json:"size" binding:"exists"`
	Parent string `form:"parent" binding:"exists"`
}

type BodyShare struct {
	Id      int64 `json:"id"`
	MId     int64 `json:"mid"`
	Private bool  `json:"private"`
}

// 	bucket=callback-test&object=test.txt&etag=D8E8FCA2DC0F896FD7CB4CB0031BA249&size=5&mimeType=text%2Fplain&imageInfo.height=&imageInfo.width=&imageInfo.format=&x:var1=for-callback-test
