package cloudengine

import (
	"time"
)

type Object struct {
	Key          string    `json:"key"`
	Type         string    `json:"type"`
	Size         int64     `json:"size"`
	ETag         string    `json:"etag"`
	LastModified time.Time `json:"last_modified"`
}
type Objects []Object

type CE interface {
	SignURL(bucketName, objectKey, method, contentType string) (url string, err error)
	ListObject(bucketName, prefix, marker string, limit int) (objects Objects, nextMarker string, err error)
	DeleteObject(bucketName, objectKey string) error
	DeleteObjects(bucketName string, objectKeys []string) error
}
