package disk

import (
	"fmt"
	"net/url"
	"strings"
	"zpan/config"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

var urlEncode = url.QueryEscape

type AliOss struct {
	cli *oss.Client
}

func NewAliOss(conf *config.Provider, options ...oss.ClientOption) (*AliOss, error) {
	cli, err := oss.New(conf.Endpoint, conf.AccessKey, conf.AccessSecret, options...)
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

func (ao *AliOss) UploadURL(bucketName, filename, objectKey, contentType, callback string, publicRead bool) (url string, headers map[string]string, err error) {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return
	}

	objectACL := oss.ACLDefault
	if publicRead {
		objectACL = oss.ACLPublicRead
	}

	options := []oss.Option{
		oss.ContentType(contentType),
		oss.Callback(callback),
		oss.ObjectACL(objectACL),
	}

	url, err = bucket.SignURL(objectKey, oss.HTTPPut, 60, options...)
	headers = map[string]string{
		"Content-Type":        contentType,
		"Content-Disposition": fmt.Sprintf(`attachment;filename="%s"`, urlEncode(filename)),
		"X-Oss-Callback":      callback,
		"X-Oss-Object-Acl":    string(objectACL),
	}

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

func (ao *AliOss) TagRename(bucketName, objectKey, filename string) (err error) {
	bucket, err := ao.cli.Bucket(bucketName)
	if err != nil {
		return
	}

	disposition := fmt.Sprintf(`attachment;filename="%s"`, urlEncode(filename))
	err = bucket.SetObjectMeta(objectKey, oss.ContentDisposition(disposition))
	return
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
