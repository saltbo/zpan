package dao

import (
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/saltbo/zpan/internal/app/model"
)

type Share struct {
}

func NewShare() *Share {
	return &Share{}
}

func (s *Share) Create(share *model.Share) error {
	return gdb.Create(share).Error
}

func (s *Share) Update(id int64, share *model.Share) error {
	if err := gdb.First(&model.Storage{}, id).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("share not found")
	}

	return gdb.Save(share).Error
}
func (s *Share) Delete(id int64) error {
	share := new(model.Share)
	return gdb.Delete(share, id).Error
}

func (s *Share) FindAll(uid int64) (list []*model.Share, total int64, err error) {
	query := NewQuery()
	query.WithEq("uid", uid)
	gdb.Model(model.Share{}).Count(&total)
	err = gdb.Find(&list).Offset(query.Offset).Limit(query.Limit).Error
	return
}

func (s *Share) Find(id int64) (share *model.Share, err error) {
	share = new(model.Share)
	err = gdb.First(share, id).Error
	return
}

func (s *Share) FindByAlias(alias string) (share *model.Share, err error) {
	share = new(model.Share)
	err = gdb.First(share, "alias=?", alias).Error
	return
}
