package bind

type QueryUser struct {
	Uxs []string `form:"ux"`
}

type BodyStorageQuota struct {
	Max uint64 `json:"max"`
}
