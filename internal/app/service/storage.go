package service

import (
	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/provider"
)

type Storage struct {
	dStorage *dao.Storage
}

func NewStorage() *Storage {
	return &Storage{
		dStorage: dao.NewStorage(),
	}
}

func (s *Storage) Create(storage *model.Storage) error {
	conf := provider.Config{
		Provider:     storage.Provider,
		Bucket:       storage.Bucket,
		Endpoint:     storage.Endpoint,
		Region:       storage.Region,
		CustomHost:   storage.CustomHost,
		AccessKey:    storage.AccessKey,
		AccessSecret: storage.SecretKey,
	}
	p, err := provider.New(conf)
	if err != nil {
		return err
	}

	if err := p.SetupCORS(); err != nil {
		return err
	}

	return s.dStorage.Create(storage)
}

// fixme: 单元测试mock侵入了业务代码，有没有更好的办法？
func (s *Storage) Get(id interface{}) (*model.Storage, error) {
	if sid, ok := id.(int64); ok && sid == 0 {
		return &model.Storage{}, nil
	}

	return s.dStorage.Find(id)
}

// fixme: 单元测试mock侵入了业务代码，有没有更好的办法？
func (s *Storage) GetProvider(id interface{}) (provider.Provider, error) {
	if sid, ok := id.(int64); ok && sid == 0 {
		return &provider.MockProvider{}, nil
	}

	storage, err := s.Get(id)
	if err != nil {
		return nil, err
	}

	return s.GetProviderByStorage(storage)
}

// fixme: 单元测试mock侵入了业务代码，有没有更好的办法？
func (s *Storage) GetProviderByStorage(storage *model.Storage) (provider.Provider, error) {
	if storage.Id == 0 {
		return &provider.MockProvider{}, nil
	}

	conf := provider.Config{
		Provider:     storage.Provider,
		Bucket:       storage.Bucket,
		Endpoint:     storage.Endpoint,
		CustomHost:   storage.CustomHost,
		AccessKey:    storage.AccessKey,
		AccessSecret: storage.SecretKey,
	}
	return provider.New(conf)
}
