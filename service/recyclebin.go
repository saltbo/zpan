package service

import (
	"fmt"

	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/service/matter"
)

type RecycleBin struct {
	provider disk.Provider
}

func NewRecycleBin(provider disk.Provider) *RecycleBin {
	return &RecycleBin{
		provider: provider,
	}
}

func (rb *RecycleBin) FindAll(uid int64, offset, limit int, options ...matter.QueryOption) (list []model.Matter, total int64, err error) {
	mq := matter.NewQuery(uid, options...)
	sn := gormutil.DB().Where(mq.SQL, mq.Params...)
	sn.Model(model.Matter{}).Count(&total)
	sn = sn.Order("dirtype desc")
	err = sn.Unscoped().Offset(offset).Limit(limit).Find(&list).Error
	return
}

func (rb *RecycleBin) Recovery(uid int64, alias string) error {
	_, err := rb.find(uid, alias)
	if err != nil {
		return err
	}

	return gormutil.DB().Unscoped().Model(&model.Matter{}).Where("alias=?", alias).Update("deleted_at", nil).Error
}

func (rb *RecycleBin) Delete(uid int64, alias string) error {
	m, err := rb.find(uid, alias)
	if err != nil {
		return err
	}

	if err := rb.provider.ObjectDelete(m.Object); err != nil {
		return err
	}

	return gormutil.DB().Unscoped().Where("alias=?", alias).Delete(&model.Matter{}).Error
}


func (rb *RecycleBin) find(uid int64, alias string) (*model.Matter, error) {
	m := new(model.Matter)
	if gormutil.DB().Unscoped().First(m, "alias=?", alias).RecordNotFound() {
		return nil, fmt.Errorf("file not exist")
	} else if !m.UserAccessible(uid) {
		return nil, fmt.Errorf("not accessible")
	}

	return m, nil
}
