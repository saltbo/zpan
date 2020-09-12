package service

import (
	"fmt"
	"strings"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func FolderRename(src *model.Matter, name string) error {
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

func FolderMove(src *model.Matter, parent string) error {
	var children []model.Matter
	err := gormutil.DB().Where("parent like ?", "%"+src.Name+"%").Find(&children).Error
	if err != nil {
		return err
	}
	for _, v := range children {
		err := gormutil.DB().Model(v).Update("parent", parent+src.Name+"/").Error
		if err != nil {
			return err
		}
	}
	return gormutil.DB().Model(src).Update("parent", parent).Error
}
