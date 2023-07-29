package mock

import (
	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
)

var _ repo.RecycleBin = (*RecycleBin)(nil)

type RecycleBin struct {
	mockStore[*entity.RecycleBin, *repo.RecycleBinFindOptions, string]
}

func NewRecycleBin() *RecycleBin {
	return &RecycleBin{}
}
