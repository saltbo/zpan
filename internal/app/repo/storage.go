package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/saltbo/zpan/internal/app/entity"
	"gorm.io/gorm"
)

type StorageFindOptions struct {
	Offset int
	Limit  int
}

type Storage interface {
	BasicOP[*entity.Storage, int64, *StorageFindOptions]
}

var _ Storage = (*StorageDBQuery)(nil)

type StorageDBQuery struct {
	DBQuery
}

func NewStorageDBQuery(q DBQuery) *StorageDBQuery {
	return &StorageDBQuery{DBQuery: q}
}

func (s *StorageDBQuery) Find(ctx context.Context, id int64) (*entity.Storage, error) {
	return s.Q().Storage.WithContext(ctx).Where(s.Q().Storage.Id.Eq(id)).First()
}

func (s *StorageDBQuery) FindAll(ctx context.Context, opts *StorageFindOptions) (storages []*entity.Storage, total int64, err error) {
	return s.Q().Storage.WithContext(ctx).FindByPage(opts.Offset, opts.Limit)
}

func (s *StorageDBQuery) Create(ctx context.Context, storage *entity.Storage) error {
	if _, err := s.Q().Storage.Where(s.Q().Storage.Name.Eq(storage.Name)).First(); !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage already exist")
	}

	return s.Q().Storage.WithContext(ctx).Create(storage)
}

func (s *StorageDBQuery) Update(ctx context.Context, id int64, storage *entity.Storage) error {
	existStorage, err := s.Find(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage not found")
	}

	// 如果SK是掩码则忽略
	if strings.HasPrefix(storage.SecretKey, "***") {
		storage.SecretKey = existStorage.SecretKey
	}

	_, err = s.Q().Storage.WithContext(ctx).Where(s.Q().Storage.Id.Eq(id)).Updates(storage)
	return err
}

func (s *StorageDBQuery) Delete(ctx context.Context, id int64) error {
	storage := new(entity.Storage)
	if _, err := s.Find(ctx, id); errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage not exist")
	}

	_, err := s.Q().Storage.WithContext(ctx).Delete(storage)
	return err
}
