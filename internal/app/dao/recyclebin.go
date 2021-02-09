package dao

import (
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/saltbo/zpan/internal/app/model"
)

type RecycleBin struct {
}

func NewRecycleBin() *RecycleBin {
	return &RecycleBin{
	}
}

func (rb *RecycleBin) FindAll(q *Query) (list []model.Recycle, total int64, err error) {
	sn := gdb.Where(q.SQL(), q.Params...)
	sn.Model(model.Recycle{}).Count(&total)
	sn = sn.Order("dirtype desc")
	if q.Offset > 0 {
		sn = sn.Offset(q.Offset)
	}
	if q.Limit > 0 {
		sn = sn.Limit(q.Limit)
	}
	err = sn.Find(&list).Error
	return
}

func (rb *RecycleBin) Find(uid int64, alias string) (*model.Recycle, error) {
	m := new(model.Recycle)
	if err := gdb.Unscoped().First(m, "alias=?", alias).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("file not exist")
	} else if !m.UserAccessible(uid) {
		return nil, fmt.Errorf("not accessible")
	}

	return m, nil
}

func (rb *RecycleBin) Release(uid, size int64, query interface{}, args ...interface{}) error {
	fc := func(tx *gorm.DB) error {
		// release the user storage
		expr := gorm.Expr("used-?", size)
		if err := tx.Model(&model.UserStorage{}).Where("uid=?", uid).Update("used", expr).Error; err != nil {
			return err
		}

		// clean the RecycleBin
		return tx.Where(query, args...).Delete(&model.Recycle{}).Error
	}

	return gdb.Transaction(fc)
}
