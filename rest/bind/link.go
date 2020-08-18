package bind

type BodyUploadLink struct {
	Name string `json:"name" binding:"required"`
	Type string `json:"type"`
	Size int64  `json:"size"`
	Dir  string `json:"dir"`
}

type BodyDownloadLink struct {
	Id int64 `json:"id" binding:"required"`
}
