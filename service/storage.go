package service

import (
	"fmt"
	"strconv"

	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

type Storage struct {
}

func NewStorage() *Storage {
	return &Storage{}
}

func (s *Storage) Find(id string) (*model.Storage, error) {
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
