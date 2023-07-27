package mock

import (
	"context"
	"fmt"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/samber/lo"
)

var _ repo.Matter = (*Matter)(nil)

type Matter struct {
	mockStore[*entity.Matter, *repo.ListOption, int64]
}

func NewMatter() *Matter {
	return &Matter{}
}

func (mk *Matter) FindByAlias(ctx context.Context, alias string) (*entity.Matter, error) {
	matter, ok := lo.Find(mk.store, func(item *entity.Matter) bool {
		return item.Alias == alias
	})
	if !ok {
		return nil, fmt.Errorf("not found: %v", alias)
	}

	return matter, nil
}

func (mk *Matter) FindByPath(ctx context.Context, filepath string) (*entity.Matter, error) {
	matter, ok := lo.Find(mk.store, func(item *entity.Matter) bool {
		return item.FullPath() == filepath
	})
	if !ok {
		return nil, fmt.Errorf("not found: %v", filepath)
	}

	return matter, nil
}

func (mk *Matter) Copy(ctx context.Context, id int64, to string) (*entity.Matter, error) {
	matter, err := mk.Find(ctx, id)
	if err != nil {
		return nil, err
	}

	newMatter := matter.Clone()
	newMatter.Parent = to
	mk.store = append(mk.store, newMatter)
	return newMatter, nil
}

func (mk *Matter) Recovery(ctx context.Context, mid int64) error {
	return nil
}

func (mk *Matter) GetObjects(ctx context.Context, id int64) ([]string, error) {
	return []string{}, nil
}
