package mock

import (
	"context"
	"fmt"

	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/samber/lo"
)

type Entity[ID repo.IDType] interface {
	comparable
	GetID() ID
}

type mockStore[T Entity[ID], O any, ID repo.IDType] struct {
	store []T
}

func (ms *mockStore[T, O, ID]) Create(ctx context.Context, t T) error {
	ms.store = append(ms.store, t)
	return nil
}

func (ms *mockStore[T, O, ID]) Find(ctx context.Context, id ID) (T, error) {
	v, ok := lo.Find(ms.store, func(item T) bool {
		return item.GetID() == id
	})

	if !ok {
		var result T
		return result, fmt.Errorf("not found: %v", id)
	}

	return v, nil
}

func (ms *mockStore[T, O, ID]) FindAll(ctx context.Context, opts O) ([]T, int64, error) {
	return ms.store, int64(len(ms.store)), nil
}

func (ms *mockStore[T, O, ID]) Update(ctx context.Context, id ID, t T) error {
	matter, err := ms.Find(ctx, id)
	if err != nil {
		return err
	}

	idx := lo.IndexOf(ms.store, matter)
	ms.store[idx] = t
	return nil
}

func (ms *mockStore[T, O, ID]) Delete(ctx context.Context, id ID) error {
	matter, err := ms.Find(ctx, id)
	if err != nil {
		return err
	}

	idx := lo.IndexOf(ms.store, matter)
	ms.store = append(ms.store[:idx], ms.store[idx+1:]...)
	return nil
}
