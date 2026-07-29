package restishzpan

import "time"

type uploadPart struct {
	PartNumber int               `json:"partNumber"`
	URL        string            `json:"url"`
	ExpiresAt  string            `json:"expiresAt"`
	Headers    map[string]string `json:"headers"`
}

type uploadInstructions struct {
	SessionID          string            `json:"sessionId"`
	UploadID           *string           `json:"uploadId"`
	Mode               string            `json:"mode"`
	PartSize           int64             `json:"partSize"`
	PartCount          int               `json:"partCount"`
	ExpiresAt          string            `json:"expiresAt"`
	PresignedExpiresAt string            `json:"presignedExpiresAt"`
	RequiredHeaders    map[string]string `json:"requiredHeaders"`
	Parts              []uploadPart      `json:"parts"`
}

type matterResult struct {
	ID        string              `json:"id"`
	OrgID     string              `json:"orgId,omitempty"`
	Alias     string              `json:"alias,omitempty"`
	Name      string              `json:"name"`
	Type      string              `json:"type,omitempty"`
	Size      *int64              `json:"size,omitempty"`
	Parent    string              `json:"parent,omitempty"`
	Object    string              `json:"object,omitempty"`
	StorageID string              `json:"storageId,omitempty"`
	Status    string              `json:"status,omitempty"`
	CreatedAt string              `json:"createdAt,omitempty"`
	UpdatedAt string              `json:"updatedAt,omitempty"`
	Upload    *uploadInstructions `json:"upload,omitempty"`
}

type presignPartsResult struct {
	UploadID           *string           `json:"uploadId"`
	Mode               string            `json:"mode"`
	PartSize           int64             `json:"partSize"`
	PartCount          int               `json:"partCount"`
	PresignedExpiresAt string            `json:"presignedExpiresAt"`
	RequiredHeaders    map[string]string `json:"requiredHeaders"`
	Parts              []uploadPart      `json:"parts"`
}

type completedPart struct {
	PartNumber int    `json:"partNumber"`
	ETag       string `json:"etag"`
}

type uploadResult struct {
	Object      matterResult `json:"object"`
	Upload      resultUpload `json:"upload"`
	Checkpoint  string       `json:"checkpoint,omitempty"`
	CompletedAt time.Time    `json:"completedAt"`
}

type resultUpload struct {
	API       string          `json:"api"`
	Profile   string          `json:"profile,omitempty"`
	SessionID string          `json:"sessionId"`
	Mode      string          `json:"mode"`
	PartSize  int64           `json:"partSize"`
	PartCount int             `json:"partCount"`
	Parts     []completedPart `json:"parts"`
}
