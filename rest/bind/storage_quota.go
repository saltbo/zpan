package bind

type QueryStorage struct {
	QueryPage
	Email string `form:"email"`
}

type BodyStorageQuota struct {
	Max uint64 `json:"max"`
}
