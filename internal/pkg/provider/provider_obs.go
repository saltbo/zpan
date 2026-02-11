package provider

import (
	"github.com/saltbo/zpan/internal/pkg/logger"
	"github.com/saltbo/zpan/pkg/obs"
)

// OBSProvider 华为云
type OBSProvider struct {
	S3Provider

	client *obs.ObsClient
}

func NewOBSProvider(conf *Config) (Provider, error) {
	logger.Debug("Initializing OBSProvider",
		"endpoint", conf.Endpoint,
		"bucket", conf.Bucket,
		"accessKey", conf.AccessKey[:minInt(3, len(conf.AccessKey))]+"***",
		"pathStyle", conf.PathStyle)

	client, err := obs.New(conf.AccessKey, conf.AccessSecret, conf.Endpoint)
	if err != nil {
		logger.Error("Failed to create OBS client", "error", err)
		return nil, err
	}
	logger.Debug("OBS client created successfully")

	p, err := newS3Provider(conf)
	if err != nil {
		logger.Error("Failed to initialize S3Provider", "error", err)
		return nil, err
	}

	return &OBSProvider{
		S3Provider: *p,

		client: client,
	}, err
}

func minInt(i1, i2 int) int {
	if i1 < i2 {
		return i1
	}
	return i2
}

func (p *OBSProvider) SetupCORS() error {
	logger.Debug("Starting CORS setup for bucket", "bucket", p.bucket)

	var existRules []obs.CorsRule
	ret, err := p.client.GetBucketCors(p.bucket)
	if err != nil {
		logger.Debug("Failed to get existing CORS rules (using OBS SDK)",
			"error", err,
			"action", "falling back to S3 API")
		// If OBS SDK fails, try S3 API as fallback
		return p.S3Provider.SetupCORS()
	} else if ret != nil && len(ret.CorsRules) > 0 {
		logger.Debug("Found existing CORS rules", "count", len(ret.CorsRules))
		existRules = append(existRules, ret.CorsRules...)
	} else {
		logger.Debug("No existing CORS rules found")
	}

	zRule := obs.CorsRule{
		AllowedOrigin: []string{"*"},
		AllowedMethod: corsAllowMethods,
		AllowedHeader: corsAllowHeaders,
		MaxAgeSeconds: 300,
	}
	logger.Debug("Setting CORS rule",
		"methods", corsAllowMethods,
		"headers", corsAllowHeaders)

	input := &obs.SetBucketCorsInput{
		Bucket:     p.bucket,
		BucketCors: obs.BucketCors{CorsRules: append(existRules, zRule)},
	}
	_, err = p.client.SetBucketCors(input)
	if err != nil {
		logger.Debug("Failed to set CORS rules using OBS SDK",
			"error", err,
			"action", "falling back to S3 API")
		return p.S3Provider.SetupCORS()
	}
	logger.Debug("CORS setup completed successfully")
	return nil
}
