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
	ParentId string `form:"parent_id"`
}

type BodyUser struct {
	Email string `json:"email"`
	PwdR  string `json:"pwdr"`
	PwdC  string `json:"pwdc"`
}

type QueryMatter struct {
	Object   string `form:"object" binding:"required"`
	Type     string `form:"type" binding:"required"`
	ParentId int64  `form:"parent_id" binding:"required"`
}

type BodyMatter struct {
	Uid      int64  `json:"uid"`
	Path     string `json:"path" binding:"required"`
	Type     string `json:"type" binding:"required"`
	Size     int64  `json:"size" binding:"required"`
	ParentId int64  `json:"parent_id" binding:"required"`
}

//	bucket=callback-test&object=test.txt&etag=D8E8FCA2DC0F896FD7CB4CB0031BA249&size=5&mimeType=text%2Fplain&imageInfo.height=&imageInfo.width=&imageInfo.format=&x:var1=for-callback-test
