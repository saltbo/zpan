package vfs

import (
	"context"
	"fmt"
	"path"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase/uploader"
)

var _ VirtualFs = (*Vfs)(nil)

type Vfs struct {
	matterRepo     repo.Matter
	recycleBinRepo repo.RecycleBin
	uploader       uploader.Uploader
}

func NewVfs(matterRepo repo.Matter, recycleBinRepo repo.RecycleBin, uploader uploader.Uploader) *Vfs {
	return &Vfs{matterRepo: matterRepo, recycleBinRepo: recycleBinRepo, uploader: uploader}
}

func (v *Vfs) Create(ctx context.Context, m *entity.Matter) error {
	if !m.IsDir() {
		if err := v.uploader.CreateUploadURL(ctx, m); err != nil {
			return err
		}
	}

	return v.matterRepo.Create(ctx, m)
}

func (v *Vfs) List(ctx context.Context, option *repo.MatterListOption) ([]*entity.Matter, int64, error) {
	return v.matterRepo.FindAll(ctx, option)
}

func (v *Vfs) Get(ctx context.Context, alias string) (*entity.Matter, error) {
	matter, err := v.matterRepo.FindByAlias(ctx, alias)
	if err != nil {
		return nil, err
	}

	if matter.IsDir() {
		return matter, nil
	}

	return matter, v.uploader.CreateVisitURL(ctx, matter)
}

func (v *Vfs) Rename(ctx context.Context, alias string, newName string) error {
	m, err := v.matterRepo.FindByAlias(ctx, alias)
	if err != nil {
		return err
	}

	if exist := v.matterRepo.PathExist(ctx, path.Join(m.Parent, newName)); exist {
		return fmt.Errorf("dir already has the same name file")
	}

	m.Name = newName
	return v.matterRepo.Update(ctx, m.Id, m)
}

func (v *Vfs) Move(ctx context.Context, alias string, to string) error {
	m, err := v.matterRepo.FindByAlias(ctx, alias)
	if err != nil {
		return err
	}

	if exist := v.matterRepo.PathExist(ctx, path.Join(to, m.Name)); exist {
		return fmt.Errorf("dir already has the same name file")
	}

	m.Parent = to
	return v.matterRepo.Update(ctx, m.Id, m)
}

func (v *Vfs) Copy(ctx context.Context, alias string, to string) (*entity.Matter, error) {
	m, err := v.matterRepo.FindByAlias(ctx, alias)
	if err != nil {
		return nil, err
	}

	return v.matterRepo.Copy(ctx, m.Id, to)
}

func (v *Vfs) Delete(ctx context.Context, alias string) error {
	m, err := v.matterRepo.FindByAlias(ctx, alias)
	if err != nil {
		return err
	}

	if err := v.matterRepo.Delete(ctx, m.Id); err != nil {
		return err
	}

	rb := m.BuildRecycleBinItem()
	return v.recycleBinRepo.Create(ctx, rb)
}
