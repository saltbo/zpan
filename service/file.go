package service

import (
	"errors"
	fmt "fmt"
	"strings"
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

func CanMove(uid int64, parent string, file *model.Matter) (bool, error) {
	//check dir exists
	if !MatterParentExist(uid, parent) {
		return false, errors.New("dir does not exists")
	}
	//avoid move to itself
	//eg: a/ -> a/
	//eg: a/ -> a/b/c
	//eg: b/ -> a/b/c
	if parent != "" && strings.HasPrefix(parent, file.Parent+file.Name) {
		return false, errors.New("can not move to itself")
	}
	//avoid move to same place
	if parent == file.Parent {
		return false, errors.New("file already in this dir")
	}
	//avoid dst dir has the same name file
	if MatterExist(uid, file.Name, parent) {
		return false, errors.New("dir already has the same name file")
	}

	return true, nil
}
