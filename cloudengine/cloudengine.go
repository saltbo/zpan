package cloudengine

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

type CE interface {
	UploadURL(bucketName, objectKey, contentType, callback string) (url string, err error)
	DownloadURL(bucketName, objectKey string) (url string, err error)
	ListObject(bucketName, prefix, marker string, limit int) (objects Objects, nextMarker string, err error)
	DeleteObject(bucketName, objectKey string) error
	DeleteObjects(bucketName string, objectKeys []string) error
}
