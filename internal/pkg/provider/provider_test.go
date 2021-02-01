package provider

import (
	"fmt"
	"net/url"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/stretchr/testify/assert"
)

// default config
var dc = Config{
	Provider:     "s3",
	Bucket:       "test-bucket",
	Endpoint:     "s3.ap-northeast-1.amazonaws.com",
	AccessKey:    "test-ak",
	AccessSecret: "test-sk",
}

var key = "1001/test.txt"

func checkSignedURLStr(t *testing.T, us, customHost string) *url.URL {
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

func testSignedGetUrl(t *testing.T, conf Config) {
	disk, err := New(conf)
	assert.NoError(t, err)

	us, headers, err := disk.SignedPutURL(key, "text/plain", false)
	assert.NoError(t, err)
	checkSignedURLStr(t, us, conf.CustomHost)

	assert.Equal(t, s3.ObjectCannedACLAuthenticatedRead, headers.Get("x-amz-acl"))
	assert.Equal(t, "text/plain", headers.Get("content-type"))
}

func TestSignedPutURL(t *testing.T) {
	testSignedGetUrl(t, dc)
}

func TestSignedPutURLWithCustomHost(t *testing.T) {
	conf := dc
	conf.CustomHost = "http://dl.zpan.com"
	testSignedGetUrl(t, conf)
}

func TestSignedGetURL(t *testing.T) {
	disk, err := New(dc)
	assert.NoError(t, err)

	filename := "test2.txt"
	us, err := disk.SignedGetURL(key, filename)
	assert.NoError(t, err)
	u := checkSignedURLStr(t, us, "")
	assert.Equal(t, u.Query().Get("response-content-disposition"), fmt.Sprintf(`attachment;filename="%s"`, urlEncode(filename)))
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
