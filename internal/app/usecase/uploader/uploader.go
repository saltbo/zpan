package uploader

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
)

type Uploader interface {
	CreateUploadURL(ctx context.Context, m *entity.Matter) error
	CreateVisitURL(ctx context.Context, m *entity.Matter) error
	UploadDone(ctx context.Context, m *entity.Matter) error
}
