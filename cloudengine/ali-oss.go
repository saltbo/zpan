package cloudengine

import (
	"fmt"
	"path/filepath"
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

func (ao *AliOss) SetLifecycle(bucketName string) error {
	rule := oss.BuildLifecycleRuleByDays("zpan-recyclebin-auto-clean", "", true, 30)
	rule.Tags = []oss.Tag{
		{Key: "Zpan-Dt", Value: "deleted"},
	}
	rule.Transitions = []oss.LifecycleTransition{
		{Days: 3, StorageClass: oss.StorageArchive},
	}

	return ao.cli.SetBucketLifecycle(bucketName, []oss.LifecycleRule{rule})
}

func (ao *AliOss) UploadURL(bucketName, objectKey, contentType, callback string) (url string, err error) {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return
	}

	options := []oss.Option{
		oss.ContentType(contentType),
		oss.ContentDisposition(fmt.Sprintf(`attachment;filename="%s"`, filepath.Base(bucketName))),
		oss.Callback(callback),
	}
	url, err = bucket.SignURL(objectKey, oss.HTTPPut, 60, options...)
	return
}

func (ao *AliOss) DownloadURL(bucketName, objectKey string) (url string, err error) {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return
	}

	options := []oss.Option{}
	url, err = bucket.SignURL(objectKey, oss.HTTPGet, 60, options...)
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

func (ao *AliOss) TagDelObject(bucketName, objectKey string) error {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return err
	}

	tagging := oss.Tagging{
		Tags: []oss.Tag{
			{Key: "Zpan-Dt", Value: "deleted"},
		},
	}
	return bucket.PutObjectTagging(objectKey, tagging)
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
