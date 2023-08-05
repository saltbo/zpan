package vfs

import (
	"context"
	"fmt"
	"path"

	"github.com/robfig/cron"
	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase/uploader"
)

var _ VirtualFs = (*Vfs)(nil)

type Vfs struct {
	matterRepo     repo.Matter
	recycleBinRepo repo.RecycleBin
	userRepo       repo.User
	uploader       uploader.Uploader
	eventWorker    *EventWorker
}

func NewVfs(matterRepo repo.Matter, recycleBinRepo repo.RecycleBin, userRepo repo.User, uploader uploader.Uploader) *Vfs {
	vfs := &Vfs{matterRepo: matterRepo, recycleBinRepo: recycleBinRepo, userRepo: userRepo, uploader: uploader, eventWorker: NewWorker()}
	vfs.eventWorker.registerEventHandler(EventActionCreated, vfs.matterCreatedEventHandler)
	vfs.eventWorker.registerEventHandler(EventActionDeleted, vfs.matterDeletedEventHandler)
	_ = cron.New().AddFunc("30 1 * * *", vfs.cleanExpiredMatters)
	go vfs.eventWorker.Run()
	return vfs
}

func (v *Vfs) Create(ctx context.Context, m *entity.Matter) error {
	if !m.IsDir() {
		us, err := v.userRepo.GetUserStorage(ctx, m.Uid)
		if err != nil {
			return fmt.Errorf("error getting user storage: %v", err)
		} else if us.Overflowed(m.Size) {
			return fmt.Errorf("insufficient storage space")
		}

		if err := v.uploader.CreateUploadURL(ctx, m); err != nil {
			return err
		}

		defer v.eventWorker.sendEvent(EventActionCreated, m)
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

	defer v.eventWorker.sendEvent(EventActionDeleted, m)
	rb := m.BuildRecycleBinItem()
	return v.recycleBinRepo.Create(ctx, rb)
}
