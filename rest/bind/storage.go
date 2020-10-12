package bind

type QueryStorage struct {
	QueryPage
	Email string `form:"email"`
}

type BodyStorage struct {
	Max uint64 `json:"max"`
}
