package service

import (
	fmt "fmt"
	"time"

	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func FileGet(alias string) (*model.Matter, error) {
	m := new(model.Matter)
	if gormutil.DB().First(m, "alias=?", alias).RecordNotFound() {
		return nil, fmt.Errorf("file not exist")
	}

	return m, nil
}

func UserFileGet(uid int64, alias string) (*model.Matter, error) {
	m, err := FileGet(alias)
	if err != nil {
		return nil, err
	} else if m.Uid != uid {
		return nil, fmt.Errorf("file not belong to you")
	}

	return m, nil
}

func FileUploaded(src *model.Matter) error {
	return gormutil.DB().Model(src).Update("uploaded_at", time.Now()).Error
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
