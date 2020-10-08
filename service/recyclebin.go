package service

import (
	"fmt"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/provider"
	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/service/matter"
)

type RecycleBin struct {
	matter.Matter

	provider provider.Provider
}

func NewRecycleBin(provider provider.Provider) *RecycleBin {
	return &RecycleBin{
		provider: provider,
	}
}

func (rb *RecycleBin) FindAll(uid int64, offset, limit int) (list []model.Recycle, total int64, err error) {
	sn := gormutil.DB().Where("uid=?", uid)
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

	// todo delete the remote object
	//if err := rb.provider.ObjectDelete(m.Object); err != nil {
	//	return err
	//}

	if m.IsDir() {
		// 计算文件夹所占的所有空间
		children, err := rb.UnscopedChildren(m.Uid, m.FullPath())
		if err != nil {
			return err
		}
		for _, child := range children {
			m.Size += child.Size
		}
		//	todo delete the remote object
	}

	return rb.release(m.Uid, m.Size, "alias=?", m.Alias)
}

func (rb *RecycleBin) Clean(uid int64) error {
	rbs := make([]model.Recycle, 0)
	if err := gormutil.DB().Where("uid=?", uid).Find(&rbs).Error; err != nil {
		return err
	}

	var size int64
	for _, recycle := range rbs {
		if recycle.Size > 0 {
			size += recycle.Size
			continue
		} else if recycle.DirType > model.DirTypeSys {
			// 获取该文件夹的所有子文件，计算目录
			children, err := rb.UnscopedChildren(recycle.Uid, recycle.FullPath())
			if err != nil {
				return err
			}

			fmt.Println(children)
			for _, child := range children {
				size += child.Size
			}
			fmt.Println(size)
		}
	}

	//	todo delete the remote object

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
