package storage

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/pkg/provider"
)

var _ Storage = (*CloudStorage)(nil)

type CloudStorage struct {
	storageRepo repo.Storage

	providerConstructor provider.Constructor
}

func NewCloudStorage(storageRepo repo.Storage) *CloudStorage {
	return &CloudStorage{storageRepo: storageRepo, providerConstructor: provider.New}
}

func NewCloudStorageWithProviderConstructor(storageRepo repo.Storage, providerConstructor provider.Constructor) *CloudStorage {
	return &CloudStorage{storageRepo: storageRepo, providerConstructor: providerConstructor}
}

func (s *CloudStorage) Create(ctx context.Context, storage *entity.Storage) error {
	p, err := s.providerConstructor(s.buildConfig(storage))
	if err != nil {
		return err
	}

	if err := p.SetupCORS(); err != nil {
		return err
	}

	return s.storageRepo.Create(ctx, storage)
}

func (s *CloudStorage) Get(ctx context.Context, sid int64) (*entity.Storage, error) {
	return s.storageRepo.Find(ctx, sid)
}

func (s *CloudStorage) GetProvider(ctx context.Context, sid int64) (provider.Provider, error) {
	storage, err := s.storageRepo.Find(ctx, sid)
	if err != nil {
		return nil, err
	}

	return s.GetProviderByStorage(storage)
}

func (s *CloudStorage) GetProviderByStorage(storage *entity.Storage) (provider.Provider, error) {
	return s.providerConstructor(s.buildConfig(storage))
}

func (s *CloudStorage) buildConfig(storage *entity.Storage) *provider.Config {
	return &provider.Config{
		Provider:     storage.Provider,
		Bucket:       storage.Bucket,
		Endpoint:     storage.Endpoint,
		Region:       storage.Region,
		CustomHost:   storage.CustomHost,
		AccessKey:    storage.AccessKey,
		AccessSecret: storage.SecretKey,
		PathStyle:    storage.PathStyle,
	}
}
