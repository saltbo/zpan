package mock

import (
	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
)

var _ repo.Storage = (*Storage)(nil)

type Storage struct {
	mockStore[*entity.Storage, *repo.StorageFindOptions, int64]
}

func NewStorage() *Storage {
	return &Storage{}
}
