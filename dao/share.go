package dao

import (
	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/pkg/gormutil"
)

type Share struct {
}

func NewShare() *Share {
	return &Share{}
}

func (s *Share) Find(id int64) (share *model.Share, err error) {
	share = new(model.Share)
	err = gormutil.DB().First(share, id).Error
	return
}

func (s *Share) FindByAlias(alias string) (share *model.Share, err error) {
	share = new(model.Share)
	err = gormutil.DB().First(share, "alias=?", alias).Error
	return
}
