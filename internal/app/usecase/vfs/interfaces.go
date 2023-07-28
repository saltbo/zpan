package vfs

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
)

type VirtualFs interface {
	Create(ctx context.Context, m *entity.Matter) error
	List(ctx context.Context, option *repo.MatterListOption) ([]*entity.Matter, int64, error)
	Get(ctx context.Context, alias string) (*entity.Matter, error)
	Rename(ctx context.Context, alias string, newName string) error
	Move(ctx context.Context, alias string, to string) error
	Copy(ctx context.Context, alias string, to string) (*entity.Matter, error)
	Delete(ctx context.Context, alias string) error
}

type RecycleBinFs interface {
	Recovery(ctx context.Context, alias string) error
	Delete(ctx context.Context, alias string) error
	Clean(ctx context.Context, sid int64) error
}
