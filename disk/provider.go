package disk

import (
	"time"
)

type Object struct {
	Key          string    `json:"key"`
	Dir          bool      `json:"dir"`
	Type         string    `json:"type"`
	Size         int64     `json:"size"`
	ETag         string    `json:"etag"`
	LastModified time.Time `json:"last_modified"`
}
type Objects []Object

type Provider interface {
	SetLifecycle(bucketName string) error
	UploadURL(bucketName, filename, objectKey, contentType, callback string, publicRead bool) (url string, headers map[string]string, err error)
	DownloadURL(bucketName, objectKey string) (url string, err error)
	ListObject(bucketName, prefix, marker string, limit int) (objects Objects, nextMarker string, err error)
	TagRename(bucketName, objectKey, filename string) error
	TagDelObject(bucketName, objectKey string) error
	DeleteObject(bucketName, objectKey string) error
	DeleteObjects(bucketName string, objectKeys []string) error
}
