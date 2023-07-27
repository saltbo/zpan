package uploader

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
)

type FakeUploader struct {
	CreateUploadURLFn func(ctx context.Context, m *entity.Matter) error
}

func (f *FakeUploader) CreateUploadURL(ctx context.Context, m *entity.Matter) error {
	return f.CreateUploadURLFn(ctx, m)
}

func (f *FakeUploader) CreateVisitURL(ctx context.Context, m *entity.Matter) error {
	return nil
}

func (f *FakeUploader) UploadDone(ctx context.Context, m *entity.Matter) error {
	return nil
}
