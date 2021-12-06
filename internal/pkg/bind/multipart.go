package bind

import (
	"github.com/saltbo/zpan/internal/pkg/provider"
)

type multipartPart struct {
	Etag       string `json:"etag"`
	PartNumber int64  `json:"number"`
}

type BodyMatterMultipart struct {
	UploadId   string           `json:"upload_id" binding:"required"`
	PartNumber int64            `json:"number"`
	PartSize   int64            `json:"size"`
	Parts      []*multipartPart `json:"parts"`
}

func (p *BodyMatterMultipart) GetParts() provider.ObjectParts {
	parts := make([]*provider.ObjectPart, 0, len(p.Parts))
	for _, part := range p.Parts {
		parts = append(parts, &provider.ObjectPart{
			Etag:       part.Etag,
			PartNumber: part.PartNumber,
		})
	}
	return parts
}
