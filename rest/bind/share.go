package bind

type BodyShare struct {
	Id        int64 `json:"id"`
	MId       int64 `json:"mid"`
	Private   bool  `json:"private"`
	ExpireSec int64 `json:"expire_sec"`
}
