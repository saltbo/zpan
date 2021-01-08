package service

import (
	"fmt"
	"strconv"

	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/provider"
)

type Storage struct {
}

func NewStorage() *Storage {
	return &Storage{}
}

func (s *Storage) Find(id interface{}) (*model.Storage, error) {
	storage := new(model.Storage)
	if gormutil.DB().First(storage, id).RecordNotFound() {
		return nil, fmt.Errorf("storage not exist")
	}

	return storage, nil
}

func (s *Storage) FindAll(offset, limit int) (list []model.Storage, total int64, err error) {
	sn := gormutil.DB()
	sn.Model(model.Storage{}).Count(&total)
	err = sn.Find(&list).Offset(offset).Limit(limit).Error
	return
}

func (s *Storage) Create(storage *model.Storage) error {
	if !gormutil.DB().First(storage, "name=?", storage.Name).RecordNotFound() {
		return fmt.Errorf("storage already exist")
	}

	return gormutil.DB().Create(storage).Error
}

func (s *Storage) Update(id string, storage *model.Storage) error {
	if gormutil.DB().First(&model.Storage{}, id).RecordNotFound() {
		return fmt.Errorf("storage not found")
	}

	storage.Id, _ = strconv.ParseInt(id, 10, 64)
	return gormutil.DB().Save(storage).Error
}

func (s *Storage) Delete(id string) error {
	storage := new(model.Storage)
	if gormutil.DB().First(storage, id).RecordNotFound() {
		return fmt.Errorf("storage not exist")
	}

	return gormutil.DB().Delete(storage).Error
}

func (s *Storage) GetProvider(id interface{}) (provider.Provider, error) {
	if sid, ok := id.(int64); ok && sid == 0 {
		return &provider.MockProvider{}, nil
	}

	sModel, err := s.Find(id)
	if err != nil {
		return nil, err
	}

	conf := provider.Config{
		Name:         "s3",
		Bucket:       sModel.Bucket,
		Endpoint:     sModel.Endpoint,
		CustomHost:   sModel.CustomHost,
		AccessKey:    sModel.AccessKey,
		AccessSecret: sModel.SecretKey,
	}
	return provider.New(conf)
}
