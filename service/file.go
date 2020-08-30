package service

import (
	"time"

	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func FileUploaded(src *model.Matter) error {
	return gormutil.DB().Model(src).Update("uploaded", time.Now()).Error
}

func FileRename(src *model.Matter, name string) error {
	return gormutil.DB().Model(src).Update("name", name).Error
}

func FileMove(src *model.Matter, parent string) error {
	return gormutil.DB().Model(src).Update("parent", parent).Error
}

func FileCopy(src *model.Matter, parent string) error {
	nm := src.Clone()
	nm.Parent = parent
	return gormutil.DB().Create(nm).Error
}
