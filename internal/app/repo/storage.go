package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo/query"
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
	q *query.Query
}

func NewStorageDBQuery(q *query.Query) *StorageDBQuery {
	return &StorageDBQuery{q: q}
}

func (s *StorageDBQuery) Find(ctx context.Context, id int64) (*entity.Storage, error) {
	return s.q.Storage.WithContext(ctx).Where(s.q.Storage.Id.Eq(id)).First()
}

func (s *StorageDBQuery) FindAll(ctx context.Context, opts *StorageFindOptions) (storages []*entity.Storage, total int64, err error) {
	return s.q.Storage.WithContext(ctx).FindByPage(opts.Offset, opts.Limit)
}

func (s *StorageDBQuery) Create(ctx context.Context, storage *entity.Storage) error {
	if _, err := s.q.Storage.Where(s.q.Storage.Name.Eq(storage.Name)).First(); !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage already exist")
	}

	return s.q.Storage.WithContext(ctx).Create(storage)
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

	_, err = s.q.Storage.WithContext(ctx).Where(s.q.Storage.Id.Eq(id)).Updates(storage)
	return err
}

func (s *StorageDBQuery) Delete(ctx context.Context, id int64) error {
	storage := new(entity.Storage)
	if _, err := s.Find(ctx, id); errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("storage not exist")
	}

	_, err := s.q.Storage.WithContext(ctx).Delete(storage)
	return err
}
