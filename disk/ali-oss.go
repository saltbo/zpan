package disk

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/url"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

var urlEncode = url.QueryEscape

type AliOss struct {
	cli    *oss.Client
	bucket *oss.Bucket
}

func newAliOss(conf Config) (*AliOss, error) {
	cli, err := oss.New(conf.Endpoint, conf.AccessKey, conf.AccessSecret)
	if err != nil {
		return nil, err
	}

	cli.Config.LogLevel = oss.Debug
	bucket, err := cli.Bucket(conf.Bucket)
	if err != nil {
		return nil, err
	}

	return &AliOss{
		cli:    cli,
		bucket: bucket,
	}, nil
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

func (ao *AliOss) BuildCallback(url, body string) string {
	callbackMap := map[string]string{
		"callbackUrl":      url,
		"callbackBodyType": "application/json",
		"callbackBody":     body,
	}
	callbackBuffer := bytes.NewBuffer([]byte{})
	callbackEncoder := json.NewEncoder(callbackBuffer)
	callbackEncoder.SetEscapeHTML(false) // do not encode '&' to "\u0026"
	if err := callbackEncoder.Encode(callbackMap); err != nil {
		log.Panic(err)
	}

	return base64.StdEncoding.EncodeToString(callbackBuffer.Bytes())
}

func (ao *AliOss) UploadURL(filename, objectKey, contentType, callback string, publicRead bool) (url string, headers map[string]string, err error) {
	objectACL := oss.ACLDefault
	if publicRead {
		objectACL = oss.ACLPublicRead
	}

	options := []oss.Option{
		oss.ContentType(contentType),
		oss.Callback(callback),
		oss.ObjectACL(objectACL),
	}
	url, err = ao.bucket.SignURL(objectKey, oss.HTTPPut, 60, options...)
	headers = map[string]string{
		"Content-Type":        contentType,
		"Content-Disposition": fmt.Sprintf(`attachment;filename="%s"`, urlEncode(filename)),
		"X-Oss-Callback":      callback,
		"X-Oss-Object-Acl":    string(objectACL),
	}

	return
}

func (ao *AliOss) DownloadURL(objectKey string) (url string, err error) {
	var options []oss.Option
	url, err = ao.bucket.SignURL(objectKey, oss.HTTPGet, 60, options...)
	return
}

func (ao *AliOss) ObjectRename(objectKey, filename string) (err error) {
	disposition := fmt.Sprintf(`attachment;filename="%s"`, urlEncode(filename))
	err = ao.bucket.SetObjectMeta(objectKey, oss.ContentDisposition(disposition))
	return
}

func (ao *AliOss) ObjectSoftDel(objectKey string) error {
	tagging := oss.Tagging{
		Tags: []oss.Tag{
			{Key: "Zpan-Dt", Value: "deleted"},
		},
	}
	return ao.bucket.PutObjectTagging(objectKey, tagging)
}

func (ao *AliOss) ObjectDelete(objectKey string) error {
	return ao.bucket.DeleteObject(objectKey)
}

func (ao *AliOss) ObjectsDelete(objectKeys []string) error {
	dor, err := ao.bucket.DeleteObjects(objectKeys)
	if err != nil {
		return nil
	}

	if len(dor.DeletedObjects) != len(objectKeys) {
		return fmt.Errorf("Incomplete deletion, deleted: %v", dor.DeletedObjects)
	}

	return nil
}
