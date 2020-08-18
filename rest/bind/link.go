package bind

type BodyUploadLink struct {
	Name string `json:"name" binding:"required"`
	Type string `json:"type"`
	Size int64  `json:"size"`
	Dir  string `json:"dir"`
}

type BodyDownloadLink struct {
	Alias string `json:"alias" binding:"required"`
}
