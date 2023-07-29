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
	rbv, err := rb.recycleRepo.Find(ctx, alias)
	if err != nil {
		return err
	}

	if err := rb.matterRepo.Recovery(ctx, rbv.Mid); err != nil {
		return err
	}

	return rb.recycleRepo.Delete(ctx, alias)
}

func (rb *RecycleBin) Delete(ctx context.Context, alias string) error {
	m, err := rb.recycleRepo.Find(ctx, alias)
	if err != nil {
		return err
	}

	matter, err := rb.matterRepo.FindWith(ctx, &repo.MatterFindWithOption{Id: m.Mid, Deleted: true})
	if err != nil {
		return err
	}

	provider, err := rb.storage.GetProvider(ctx, matter.Sid)
	if err != nil {
		return err
	}

	objects, _ := rb.matterRepo.GetObjects(ctx, matter.Id)
	if len(objects) != 0 {
		if err := provider.ObjectsDelete(objects); err != nil {
			return err
		}
	}

	return rb.recycleRepo.Delete(ctx, alias)
}

func (rb *RecycleBin) Clean(ctx context.Context, sid int64) error {
	rbs, _, err := rb.recycleRepo.FindAll(ctx, &repo.RecycleBinFindOptions{Sid: sid})
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
