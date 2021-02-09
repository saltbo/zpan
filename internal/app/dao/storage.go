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

func (s *Storage) FindAll(offset, limit int) (list []model.Storage, total int64, err error) {
	gdb.Model(model.Storage{}).Count(&total)
	err = gdb.Find(&list).Offset(offset).Limit(limit).Error
	return
}

func (s *Storage) Create(storage *model.Storage) error {
	if err := gdb.First(storage, "name=?", storage.Name).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage already exist")
	}

	return gdb.Create(storage).Error
}

func (s *Storage) Update(id string, storage *model.Storage) error {
	if err := gdb.First(&model.Storage{}, id).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage not found")
	}

	storage.Id, _ = strconv.ParseInt(id, 10, 64)
	return gdb.Save(storage).Error
}

func (s *Storage) Delete(id string) error {
	storage := new(model.Storage)
	if err := gdb.First(storage, id).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage not exist")
	}

	return gdb.Delete(storage).Error
}
