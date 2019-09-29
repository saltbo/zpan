package cloudengine

import (
	"fmt"
	"strings"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

type AliOss struct {
	cli *oss.Client
}

func NewAliOss(endpoint, accessKeyID, accessKeySecret string, options ...oss.ClientOption) (*AliOss, error) {
	cli, err := oss.New(endpoint, accessKeyID, accessKeySecret, options...)
	if err != nil {
		return nil, err
	}
	cli.Config.LogLevel = oss.Debug

	return &AliOss{cli: cli}, nil
}

func (ao *AliOss) SignURL(bucketName, objectKey, method, contentType, callback string) (url string, err error) {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return
	}

	options := []oss.Option{
		oss.ContentType(contentType),
		oss.Callback(callback),
	}
	url, err = bucket.SignURL(objectKey, oss.HTTPMethod(method), 60, options...)
	return
}

func (ao *AliOss) ListObject(bucketName, prefix, marker string, limit int) (Objects, string, error) {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return nil, "", err
	}

	objectsResult, err := bucket.ListObjects(oss.Prefix(prefix), oss.MaxKeys(limit), oss.Marker(marker))
	if err != nil {
		return nil, "", err
	}

	objects := make(Objects, 0, len(objectsResult.Objects))
	for _, v := range objectsResult.Objects {
		obj := Object{Key: v.Key, Type: v.Type, Size: v.Size, ETag: v.ETag, LastModified: v.LastModified}
		if v.Size == 0 && strings.HasSuffix(v.Key, "/") {
			obj.Dir = true
		}

		objects = append(objects, obj)
	}

	return objects, objectsResult.NextMarker, nil
}

func (ao *AliOss) DeleteObject(bucketName, objectKey string) error {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return err
	}

	return bucket.DeleteObject(objectKey)
}

func (ao *AliOss) DeleteObjects(bucketName string, objectKeys []string) error {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return err
	}

	dor, err := bucket.DeleteObjects(objectKeys)
	if err != nil {
		return nil
	}

	if len(dor.DeletedObjects) != len(objectKeys) {
		return fmt.Errorf("Incomplete deletion, deleted: %v", dor.DeletedObjects)
	}

	return nil
}
