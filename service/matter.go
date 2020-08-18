package service

import (
	"fmt"
	"strings"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func DirNotExist(uid int64, dir string) bool {
	if dir == "" {
		return false
	}

	items := strings.Split(dir, "/")
	name := items[len(items)-2]
	parent := strings.TrimSuffix(dir, name+"/")
	return gormutil.DB().Where("uid=? and name=? and parent=?", uid, name, parent).First(&model.Matter{}).RecordNotFound()
}

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

func FileCopy(src *model.Matter, dest string) error {
	nm := src.Clone()
	nm.Parent = dest
	return gormutil.DB().Create(nm).Error
}

func FileMove(src *model.Matter, dest string) error {
	return gormutil.DB().Model(src).Update("parent", dest).Error
}

func FileRename(src *model.Matter, name string) error {
	return gormutil.DB().Model(src).Update("name", name).Error
}

func DirRename(src *model.Matter, name string) error {
	oldParent := fmt.Sprintf("%s%s/", src.Parent, src.Name)
	newParent := fmt.Sprintf("%s%s/", src.Parent, name)
	list := make([]model.Matter, 0)
	gormutil.DB().Where("parent like '" + oldParent + "%'").Find(&list)

	fc := func(tx *gorm.DB) error {
		for _, v := range list {
			parent := strings.Replace(v.Parent, oldParent, newParent, 1)
			if err := tx.Model(v).Update("parent", parent).Error; err != nil {
				return err
			}
		}

		if err := tx.Model(src).Update("name", name).Error; err != nil {
			return err
		}

		return nil
	}

	return gormutil.DB().Transaction(fc)
}
