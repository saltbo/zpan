package storage

import (
	"context"
	"testing"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/mock"
	"github.com/saltbo/zpan/internal/pkg/provider"
	"github.com/stretchr/testify/assert"
)

var (
	testStorage = &entity.Storage{
		Id:    9527,
		Name:  "test",
		Title: "TEST",
	}
)

func TestCloudStorage_Create(t *testing.T) {
	ctx := context.Background()
	s := NewCloudStorageWithProviderConstructor(mock.NewStorage(), provider.NewMockProvider)
	assert.NoError(t, s.Create(context.Background(), testStorage))
	ss, err := s.Get(ctx, testStorage.Id)
	assert.NoError(t, err)
	assert.Equal(t, testStorage, ss)
}

func TestCloudStorage_GetProvider(t *testing.T) {
	ctx := context.Background()
	s := NewCloudStorageWithProviderConstructor(mock.NewStorage(), provider.NewMockProvider)
	assert.NoError(t, s.Create(context.Background(), testStorage))

	pp, err := s.GetProvider(ctx, testStorage.Id)
	assert.NoError(t, err)
	mpp, err := provider.NewMockProvider(s.buildConfig(testStorage))
	assert.NoError(t, err)
	assert.Equal(t, mpp, pp)
}
