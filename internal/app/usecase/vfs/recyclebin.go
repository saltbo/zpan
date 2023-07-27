package vfs

import (
	"context"

	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase/storage"
)

var _ RecycleBinFs = (*RecycleBin)(nil)

type RecycleBin struct {
	recycleRepo repo.RecycleBin
	matterRepo  repo.Matter
	storage     storage.Storage
}

func NewRecycleBin(recycleRepo repo.RecycleBin, matterRepo repo.Matter, storage storage.Storage) *RecycleBin {
	return &RecycleBin{recycleRepo: recycleRepo, matterRepo: matterRepo, storage: storage}
}

func (rb *RecycleBin) Recovery(ctx context.Context, alias string) error {
	m, err := rb.recycleRepo.Find(ctx, alias)
	if err != nil {
		return err
	}

	if err := rb.matterRepo.Recovery(ctx, m.Mid); err != nil {
		return err
	}

	return rb.recycleRepo.Delete(ctx, alias)
}

func (rb *RecycleBin) Delete(ctx context.Context, alias string) error {
	m, err := rb.recycleRepo.Find(ctx, alias)
	if err != nil {
		return err
	}

	objects, err := rb.matterRepo.GetObjects(ctx, m.Id)
	if err != nil {
		return err
	}

	provider, err := rb.storage.GetProvider(ctx, m.Sid)
	if err != nil {
		return err
	}

	return provider.ObjectsDelete(objects)
}

func (rb *RecycleBin) Clean(ctx context.Context) error {
	rbs, _, err := rb.recycleRepo.FindAll(ctx, repo.RecycleBinFindOptions{})
	if err != nil {
		return err
	}

	for _, rbMatter := range rbs {
		if err := rb.Delete(ctx, rbMatter.Alias); err != nil {
			return err
		}
	}

	return nil
}
