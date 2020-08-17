package service

import (
	"fmt"
	"strings"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func DirExist(uid int64, dir string) bool {
	if dir == "" {
		return true
	}

	items := strings.Split(dir, "/")
	name := items[len(items)-2]
	parent := strings.TrimSuffix(dir, name+"/")
	return !gormutil.DB().Where("uid=? and name=? and parent=?", uid, name, parent).First(&model.Matter{}).RecordNotFound()
}

func FileGet(uid int64, fileId interface{}) (*model.Matter, error) {
	m := new(model.Matter)
	if gormutil.DB().First(m, "id=?", fileId).RecordNotFound() {
		return nil, fmt.Errorf("file not exist")
	} else if m.Uid != uid {
		return nil, fmt.Errorf("file not belong to you")
	}

	return m, nil
}

func FileCopy(srcFile *model.Matter, dest string) error {
	m := &model.Matter{
		Uid:    srcFile.Uid,
		Name:   srcFile.Name,
		Type:   srcFile.Type,
		Size:   srcFile.Size,
		Parent: dest,
		Object: srcFile.Object,
	}
	return gormutil.DB().Create(m).Error
}

func FileMove(id int64, dest string) error {
	return gormutil.DB().Model(model.Matter{Id: id}).Update("parent", dest).Error
}

func FileRename(id int64, name string) error {
	return gormutil.DB().Model(model.Matter{Id: id}).Update("name", name).Error
}

func DirRename(id int64, name string) error {
	matter := new(model.Matter)
	if gormutil.DB().First(matter, "id=?", id).RecordNotFound() {
		return fmt.Errorf("matter not exist")
	}

	oldParent := fmt.Sprintf("%s%s/", matter.Parent, matter.Name)
	newParent := fmt.Sprintf("%s%s/", matter.Parent, name)
	list := make([]model.Matter, 0)
	gormutil.DB().Where("parent like '" + oldParent + "%'").Find(&list)

	fc := func(tx *gorm.DB) error {
		for _, v := range list {
			parent := strings.Replace(v.Parent, oldParent, newParent, 1)
			if err := tx.Model(v).Update("parent", parent).Error; err != nil {
				return err
			}
		}

		if err := tx.Model(matter).Update("name", name).Error; err != nil {
			return err
		}

		return nil
	}

	return gormutil.DB().Transaction(fc)
}
