package bind

type QueryRecycle struct {
	QueryPage

	Sid int64 `form:"sid" binding:"required"`
}
