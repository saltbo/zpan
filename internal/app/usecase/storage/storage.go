package storage

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/pkg/provider"
)

type Storage interface {
	Create(ctx context.Context, storage *entity.Storage) error
	Get(ctx context.Context, sid int64) (*entity.Storage, error)
	GetProvider(ctx context.Context, id int64) (provider.Provider, error)
}
