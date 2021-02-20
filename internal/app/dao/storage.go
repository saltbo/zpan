package dao

import (
	"errors"
	"fmt"
	"strconv"

	"gorm.io/gorm"

	"github.com/saltbo/zpan/internal/app/model"
)

type Storage struct {
}

func NewStorage() *Storage {
	return &Storage{}
}

func (s *Storage) Find(id interface{}) (*model.Storage, error) {
	storage := new(model.Storage)
	if err := gdb.First(storage, id).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("storage not exist")
	}

	return storage, nil
}

func (s *Storage) FindAll(offset, limit int) (storages []model.Storage, total int64, err error) {
	gdb.Model(model.Storage{}).Count(&total)
	err = gdb.Find(&storages).Offset(offset).Limit(limit).Error
	for idx, storage := range storages {
		storages[idx].SecretKey = storage.SKAsterisk() // 对外隐藏SK
	}
	return
}

func (s *Storage) Create(storage *model.Storage) error {
	if err := gdb.First(storage, "name=?", storage.Name).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage already exist")
	}

	return gdb.Create(storage).Error
}

func (s *Storage) Update(id string, storage *model.Storage) error {
	existStorage := new(model.Storage)
	if err := gdb.First(existStorage, id).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage not found")
	}

	storage.Id, _ = strconv.ParseInt(id, 10, 64)
	// 如果SK没有发生改变则不允许更新SK，避免改错SK
	if storage.SecretKey == existStorage.SKAsterisk() {
		storage.SecretKey = existStorage.SecretKey
	}
	return gdb.Save(storage).Error
}

func (s *Storage) Delete(id string) error {
	storage := new(model.Storage)
	if err := gdb.First(storage, id).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage not exist")
	}

	return gdb.Delete(storage).Error
}
