package provider

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/request"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
)

type S3Provider struct {
	client *s3.S3
	bucket string
}

func NewS3Provider(conf *Config) (Provider, error) {
	return newS3Provider(conf)
}

func newS3Provider(conf *Config) (*S3Provider, error) {
	cfg := aws.NewConfig().WithCredentials(credentials.NewStaticCredentials(conf.AccessKey, conf.AccessSecret, ""))
	s, err := session.NewSession(cfg)
	if err != nil {
		return nil, err
	}

	client := s3.New(s, cfg.WithRegion(conf.Region), cfg.WithEndpoint(conf.Endpoint))
	if conf.CustomHost != "" {
		cURL, err := url.Parse(conf.CustomHost)
		if err != nil {
			return nil, err
		}

		client.Handlers.Build.PushBack(func(r *request.Request) {
			if r.HTTPRequest.Method != http.MethodGet {
				return
			}

			r.HTTPRequest.URL.Scheme = cURL.Scheme
			r.HTTPRequest.URL.Host = cURL.Host
		})
	}

	return &S3Provider{
		client: client,
		bucket: conf.Bucket,
	}, nil
}

func (p *S3Provider) SetupCORS() error {
	var corsRules []*s3.CORSRule
	output, err := p.client.GetBucketCors(&s3.GetBucketCorsInput{Bucket: aws.String(p.bucket)})
	if output != nil && len(output.CORSRules) > 0 {
		corsRules = append(corsRules, output.CORSRules...)
	}

	allowedHeaders := make([]*string, 0)
	for _, header := range corsAllowHeaders {
		allowedHeaders = append(allowedHeaders, aws.String(header))
	}
	corsRules = append(corsRules, &s3.CORSRule{
		AllowedOrigins: []*string{aws.String("*")},
		AllowedMethods: []*string{aws.String("PUT")},
		AllowedHeaders: allowedHeaders,
		MaxAgeSeconds:  aws.Int64(300),
	})

	input := &s3.PutBucketCorsInput{
		Bucket:            aws.String(p.bucket),
		CORSConfiguration: &s3.CORSConfiguration{CORSRules: corsRules},
	}
	_, err = p.client.PutBucketCors(input)
	return err
}

func (p *S3Provider) Head(object string) (*Object, error) {
	input := &s3.HeadObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(object),
	}

	hOut, err := p.client.HeadObject(input)
	if err != nil {
		return nil, err
	}

	return &Object{
		Key:  object,
		ETag: aws.StringValue(hOut.ETag),
		Type: aws.StringValue(hOut.ContentType),
	}, nil
}

// List returns the remote objects
func (p *S3Provider) List(prefix string) ([]Object, error) {
	marker := ""
	objects := make([]Object, 0)
	for {
		input := &s3.ListObjectsInput{
			Bucket: aws.String(p.bucket),
			Prefix: aws.String(prefix),
			Marker: aws.String(marker),
		}
		objectsResult, err := p.client.ListObjects(input)
		if err != nil {
			return nil, err
		}

		for _, obj := range objectsResult.Contents {
			fObj := Object{
				Key:  aws.StringValue(obj.Key),
				ETag: strings.Trim(aws.StringValue(obj.ETag), `"`),
			}

			objects = append(objects, fObj)
		}

		if aws.BoolValue(objectsResult.IsTruncated) {
			marker = aws.StringValue(objectsResult.NextMarker)
		} else {
			break
		}
	}

	return objects, nil
}

func (p *S3Provider) Move(object, newObject string) error {
	input := &s3.CopyObjectInput{
		Bucket:     aws.String(p.bucket),
		CopySource: aws.String(object),
		Key:        aws.String(newObject),
	}
	if _, err := p.client.CopyObject(input); err != nil {
		return err
	}

	return p.ObjectDelete(object)
}

func (p *S3Provider) SignedPutURL(key, filetype string, filesize int64, public bool) (string, http.Header, error) {
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
	us, headers, err := req.PresignRequest(defaultUploadExp)
	return us, headerRebuild(headers), err
}

func (p *S3Provider) SignedGetURL(key, filename string) (string, error) {
	disposition := fmt.Sprintf(`attachment;filename="%s"`, urlEncode(filename))
	input := &s3.GetObjectInput{
		Bucket:                     aws.String(p.bucket),
		Key:                        aws.String(key),
		ResponseContentDisposition: aws.String(disposition),
	}
	req, _ := p.client.GetObjectRequest(input)
	return req.Presign(defaultDownloadExp)
}

func (p *S3Provider) PublicURL(key string) string {
	input := &s3.GetObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	}
	req, _ := p.client.GetObjectRequest(input)
	_ = req.Build()
	return req.HTTPRequest.URL.String()
}

func (p *S3Provider) ObjectDelete(key string) error {
	input := &s3.DeleteObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	}
	_, err := p.client.DeleteObject(input)
	return err
}

func (p *S3Provider) ObjectsDelete(objectKeys []string) error {
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
