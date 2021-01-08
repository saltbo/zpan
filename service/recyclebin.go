package service

import (
	"fmt"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/service/matter"
)

type RecycleBin struct {
	matter.Matter

	sStorage *Storage
}

func NewRecycleBin() *RecycleBin {
	return &RecycleBin{
		sStorage: NewStorage(),
	}
}

func (rb *RecycleBin) FindAll(uid, sid int64, offset, limit int) (list []model.Recycle, total int64, err error) {
	sn := gormutil.DB().Where("uid=? and sid=?", uid, sid)
	sn.Model(model.Recycle{}).Count(&total)
	sn = sn.Order("dirtype desc")
	err = sn.Offset(offset).Limit(limit).Find(&list).Error
	return
}

func (rb *RecycleBin) Recovery(uid int64, alias string) error {
	m, err := rb.find(uid, alias)
	if err != nil {
		return err
	}

	return rb.Matter.Recovery(m)
}

func (rb *RecycleBin) Delete(uid int64, alias string) error {
	m, err := rb.find(uid, alias)
	if err != nil {
		return err
	}

	provider, err := rb.sStorage.GetProvider(m.Sid)
	if err != nil {
		return err
	}

	if !m.IsDir() {
		// delete the remote object
		if err := provider.ObjectDelete(m.Object); err != nil {
			return err
		}
	} else {
		// get all files removed to the recycle bin
		children, err := rb.UnscopedChildren(m.Uid, alias)
		if err != nil {
			return err
		}

		objects := make([]string, 0, len(children))
		for _, child := range children {
			if child.IsDir() {
				continue
			}

			m.Size += child.Size // calc all the space occupied by the folder
			objects = append(objects, child.Object)
		}

		// delete the remote objects
		if err := provider.ObjectsDelete(objects); err != nil {
			return err
		}
	}

	return rb.release(m.Uid, m.Size, "alias=?", m.Alias)
}

func (rb *RecycleBin) Clean(uid, sid int64) error {
	rbs := make([]model.Recycle, 0)
	if err := gormutil.DB().Where("uid=? and sid=?", uid, sid).Find(&rbs).Error; err != nil {
		return err
	}

	var size int64
	objects := make([]string, 0)
	for _, recycle := range rbs {
		if recycle.Size > 0 {
			size += recycle.Size
			objects = append(objects, recycle.Object)
			continue
		} else if recycle.DirType > model.DirTypeSys {
			children, err := rb.UnscopedChildren(recycle.Uid, recycle.Alias)
			if err != nil {
				return err
			}

			for _, child := range children {
				if child.IsDir() {
					continue
				}

				objects = append(objects, child.Object)
				size += child.Size
			}
		}
	}

	if len(objects) == 0 {
		return fmt.Errorf("empty objects")
	}

	provider, err := rb.sStorage.GetProvider(sid)
	if err != nil {
		return err
	}

	//delete the remote object
	if err := provider.ObjectsDelete(objects); err != nil {
		return err
	}

	return rb.release(uid, size, "uid=?", uid)
}

func (rb *RecycleBin) release(uid, size int64, query interface{}, args ...interface{}) error {
	fc := func(tx *gorm.DB) error {
		// release the user storage
		expr := gorm.Expr("storage_used-?", size)
		if err := tx.Model(&model.User{Id: uid}).Update("storage_used", expr).Error; err != nil {
			return err
		}

		// clean the RecycleBin
		return tx.Where(query, args...).Delete(&model.Recycle{}).Error
	}

	return gormutil.DB().Transaction(fc)
}

func (rb *RecycleBin) find(uid int64, alias string) (*model.Recycle, error) {
	m := new(model.Recycle)
	if gormutil.DB().Unscoped().First(m, "alias=?", alias).RecordNotFound() {
		return nil, fmt.Errorf("file not exist")
	} else if !m.UserAccessible(uid) {
		return nil, fmt.Errorf("not accessible")
	}

	return m, nil
}
