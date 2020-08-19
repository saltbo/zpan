package bind

type BodyShare struct {
	Id        int64  `json:"id"`
	Matter    string `json:"matter"`
	Private   bool   `json:"private"`
	ExpireSec int64  `json:"expire_sec"`
}
