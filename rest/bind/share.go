package bind

type QueryShare struct {
	QueryPage
	Secret string `form:"secret"`
	Dir    string `form:"dir"`
}

type BodyShare struct {
	Id        int64  `json:"id"`
	Matter    string `json:"matter"`
	Private   bool   `json:"private"`
	ExpireSec int64  `json:"expire_sec"`
}
