package provider

import (
	"fmt"
	"net/http"
)

type MockProvider struct {
}

func (m *MockProvider) SetupCORS() error {
	return nil
}

func (m *MockProvider) Head(object string) (*Object, error) {
	return &Object{
		Key:  "20210709/86JzAOLIlGZ5Z2Fk.zip",
		Type: "application/zip",
	}, nil
}

func (m *MockProvider) List(prefix string) ([]Object, error) {
	return []Object{}, nil
}

func (m *MockProvider) Move(object, newObject string) error {
	return nil
}

func (m *MockProvider) SignedPutURL(key, filetype string, filesize int64, public bool) (url string, headers http.Header, err error) {
	headers = make(http.Header)
	headers.Add("", "")
	return fmt.Sprintf("http://dl.test.com/%s", key), headers, nil
}

func (m *MockProvider) SignedGetURL(key, filename string) (url string, err error) {
	return fmt.Sprintf("http://dl.test.com/%s", key), nil
}

func (m *MockProvider) PublicURL(key string) (url string) {
	return fmt.Sprintf("http://dl.test.com/%s", key)
}

func (m *MockProvider) ObjectDelete(key string) error {
	return nil
}

func (m *MockProvider) ObjectsDelete(keys []string) error {
	return nil
}

func (m *MockProvider) CreateMultipartUpload(key, filetype string, public bool) (uid string, err error) {
	return "", nil
}

func (m *MockProvider) CompleteMultipartUpload(key, uid string, parts []*ObjectPart) error {
	return nil
}

func (m *MockProvider) SignedPartPutURL(key, uid string, partSize, partNumber int64) (string, http.Header, error) {
	return "", nil, nil
}

func (m *MockProvider) HasMultipartSupport() bool {
	return false
}
