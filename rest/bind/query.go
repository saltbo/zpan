package bind

type QueryPage struct {
	Offset int `form:"offset"`
	Limit  int `form:"limit,default=500"`
}
