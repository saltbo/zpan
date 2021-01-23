package service

import (
	"github.com/saltbo/zpan/dao"
	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/provider"
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

func (s *Storage) GetProvider(id interface{}) (provider.Provider, error) {
	if sid, ok := id.(int64); ok && sid == 0 {
		return &provider.MockProvider{}, nil
	}

	sModel, err := s.dStorage.Find(id)
	if err != nil {
		return nil, err
	}

	conf := provider.Config{
		Provider:     sModel.Provider,
		Bucket:       sModel.Bucket,
		Endpoint:     sModel.Endpoint,
		CustomHost:   sModel.CustomHost,
		AccessKey:    sModel.AccessKey,
		AccessSecret: sModel.SecretKey,
	}
	return provider.New(conf)
}
