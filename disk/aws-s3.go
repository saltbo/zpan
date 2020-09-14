package disk

import (
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/request"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
)

type AwsS3 struct {
	client *s3.S3
	bucket string
}

func newAwsS3(conf Config, region string) (Provider, error) {
	cfg := aws.NewConfig().WithCredentials(credentials.NewStaticCredentials(conf.AccessKey, conf.AccessSecret, ""))
	s, err := session.NewSession(cfg)
	if err != nil {
		return nil, err
	}

	client := s3.New(s, cfg.WithRegion(region), cfg.WithEndpoint(conf.Endpoint))
	if conf.CustomHost != "" {
		cURL, err := url.Parse(conf.CustomHost)
		if err != nil {
			return nil, err
		}

		client.Handlers.Build.PushBack(func(r *request.Request) {
			r.HTTPRequest.URL.Scheme = cURL.Scheme
			r.HTTPRequest.URL.Host = cURL.Host
		})
	}

	return &AwsS3{
		client: client,
		bucket: conf.Bucket,
	}, nil
}

func (p *AwsS3) SignedPutURL(key, filetype string, public bool) (string, http.Header, error) {
	acl := s3.ObjectCannedACLAuthenticatedRead
	if public {
		acl = s3.ObjectCannedACLPublicRead
	}

	input := &s3.PutObjectInput{
		Bucket:      aws.String(p.bucket),
		Key:         aws.String(key),
		ACL:         aws.String(acl),
		ContentType: aws.String(filetype),
	}
	req, _ := p.client.PutObjectRequest(input)
	us, headers, err := req.PresignRequest(time.Minute * 5)
	return us, headerRebuild(headers), err
}

func (p *AwsS3) SignedGetURL(key, filename string) (string, error) {
	disposition := fmt.Sprintf(`attachment;filename="%s"`, urlEncode(filename))
	input := &s3.GetObjectInput{
		Bucket:                     aws.String(p.bucket),
		Key:                        aws.String(key),
		ResponseContentDisposition: aws.String(disposition),
	}
	req, _ := p.client.GetObjectRequest(input)
	return req.Presign(time.Minute)
}

func (p *AwsS3) PublicURL(key string) string {
	input := &s3.GetObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	}
	req, _ := p.client.GetObjectRequest(input)
	_ = req.Build()
	return req.HTTPRequest.URL.String()
}

func (p *AwsS3) ObjectDelete(key string) error {
	input := &s3.DeleteObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	}
	_, err := p.client.DeleteObject(input)
	return err
}

func (p *AwsS3) ObjectsDelete(objectKeys []string) error {
	objects := make([]*s3.ObjectIdentifier, 0, len(objectKeys))
	for _, key := range objectKeys {
		objects = append(objects, &s3.ObjectIdentifier{Key: aws.String(key)})
	}

	input := &s3.DeleteObjectsInput{
		Bucket: aws.String(p.bucket),
		Delete: &s3.Delete{
			Objects: objects,
			Quiet:   aws.Bool(false),
		},
	}
	_, err := p.client.DeleteObjects(input)
	return err
}

func headerRebuild(h http.Header) http.Header {
	nh := make(http.Header)
	for k, vs := range h {
		for _, v := range vs {
			nh.Add(k, v)
		}
	}
	return nh
}
