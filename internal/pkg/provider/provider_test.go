package provider

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/stretchr/testify/assert"
)

// default config
var dc = &Config{
	Provider:     "s3",
	Bucket:       "test-bucket",
	Endpoint:     "s3.ap-northeast-1.amazonaws.com",
	AccessKey:    "test-ak",
	AccessSecret: "test-sk",
}

var key = "1001/test.txt"

func assertSignedURL(t *testing.T, err error, us, customHost string) *url.URL {
	assert.NoError(t, err)
	host := fmt.Sprintf("%s.%s", dc.Bucket, dc.Endpoint)
	if customHost != "" {
		host = strings.TrimPrefix(customHost, "http://")
	}
	u, err := url.Parse(us)
	assert.NoError(t, err)
	assert.Equal(t, "/"+key, u.Path)
	assert.Equal(t, host, u.Host)
	assert.Contains(t, u.RawQuery, dc.AccessKey)
	assert.NotContains(t, u.RawQuery, dc.AccessSecret)
	return u
}

func TestSignedPutURL(t *testing.T) {
	disk, err := New(dc)
	assert.NoError(t, err)

	_, headers, err := disk.SignedPutURL(key, "text/plain", 0, false)
	assert.NoError(t, err)

	assert.Equal(t, s3.ObjectCannedACLAuthenticatedRead, headers.Get("x-amz-acl"))
	assert.Equal(t, "text/plain", headers.Get("content-type"))
}

func testSignedGetURL(t *testing.T, cfg *Config) {
	disk, err := New(cfg)
	assert.NoError(t, err)

	filename := "test2.txt"
	us, err := disk.SignedGetURL(key, filename)
	u := assertSignedURL(t, err, us, cfg.CustomHost)
	assert.Equal(t, u.Query().Get("response-content-disposition"), fmt.Sprintf(`attachment;filename="%s"`, urlEncode(filename)))
}

func TestSignedGetURL(t *testing.T) {
	configs := []*Config{
		dc.Clone().WithCustomHost(""),
		dc.Clone().WithCustomHost("dl.zpan.com"),
		dc.Clone().WithCustomHost("http://dl.zpan.com"),
	}

	for idx, config := range configs {
		t.Run(strconv.Itoa(idx), func(t *testing.T) {
			testSignedGetURL(t, config)
		})
	}
}

func TestPublicURL(t *testing.T) {
	disk, err := New(dc)
	assert.NoError(t, err)

	us := disk.PublicURL(key)
	u, err := url.Parse(us)
	assert.NoError(t, err)
	assert.Equal(t, "/"+key, u.Path)
	assert.Equal(t, fmt.Sprintf("%s.%s", dc.Bucket, dc.Endpoint), u.Host)
}

func TestNotSupportedProvider(t *testing.T) {
	conf := dc
	conf.Provider = "test-provider"
	_, err := New(conf)
	assert.Error(t, err)
}

func TestNew4Storage(t *testing.T) {
	conf := dc
	conf.Provider = "s3"
	_, err := New(conf)
	assert.NoError(t, err)
}
