package uploader

import (
	"context"
	"time"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase/storage"
)

var _ Uploader = (*CloudUploader)(nil)

type CloudUploader struct {
	storage    storage.Storage
	matterRepo repo.Matter
}

func NewCloudUploader(storage storage.Storage, matterRepo repo.Matter) *CloudUploader {
	return &CloudUploader{storage: storage, matterRepo: matterRepo}
}

func (u *CloudUploader) CreateUploadURL(ctx context.Context, m *entity.Matter) error {
	provider, err := u.storage.GetProvider(ctx, m.Sid)
	if err != nil {
		return err
	}

	s, err := u.storage.Get(ctx, m.Sid)
	if err != nil {
		return err
	}

	m.BuildObject(s.RootPath, s.FilePath)
	urlStr, header, err := provider.SignedPutURL(m.Object, m.Type, m.Size, s.PublicRead())
	if err != nil {
		return err
	}

	m.Uploader["upURL"] = urlStr
	m.Uploader["upHeaders"] = header
	return nil
}

func (u *CloudUploader) CreateVisitURL(ctx context.Context, m *entity.Matter) error {
	provider, err := u.storage.GetProvider(ctx, m.Sid)
	if err != nil {
		return err
	}

	s, err := u.storage.Get(ctx, m.Sid)
	if err != nil {
		return err
	}

	if s.PublicRead() {
		m.URL = provider.PublicURL(m.Object)
		return nil
	}

	link, err := provider.SignedGetURL(m.Object, m.Name)
	m.URL = link
	return err
}

func (u *CloudUploader) UploadDone(ctx context.Context, m *entity.Matter) error {
	provider, err := u.storage.GetProvider(ctx, m.Sid)
	if err != nil {
		return err
	}

	if _, err := provider.Head(m.Object); err != nil {
		return err
	}

	m.UploadedAt = time.Now()
	return u.matterRepo.Update(ctx, m.Id, m)
}
