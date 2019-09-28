package api

type QSignURL struct {
	ObjectKey   string `form:"object-key" binding:"required"`
	ContentType string `form:"content-type" binding:"required"`
}

type QueryPage struct {
	Offset int `form:"offset"`
	Limit  int `form:"limit"`
}

type QueryUser struct {
	QueryPage
	Name string `form:"name"`
}

type BodyUser struct {
	Email string `json:"email"`
	PwdR  string `json:"pwdr"`
	PwdC  string `json:"pwdc"`
}
