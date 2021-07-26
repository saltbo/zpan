package dao

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/saltbo/zpan/internal/app/model"
)

type UserKey struct {
}

func NewUserKey() *UserKey {
	return &UserKey{}
}

func (u *UserKey) Find(uid int64, name string) (*model.UserKey, error) {
	uk := new(model.UserKey)
	if err := gdb.Where("uid=? and name=?", uid, name).First(uk).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("userKey not exist")
	}

	return uk, nil
}

func (u *UserKey) FindByClientID(clientID string) (*model.UserKey, error) {
	uk := new(model.UserKey)
	if err := gdb.Where("access_key=?", clientID).First(uk).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("userKey not exist")
	}

	return uk, nil
}

func (u *UserKey) FindAll(query *Query) (list []*model.UserKey, total int64, err error) {
	sn := gdb.Model(&model.UserKey{})
	if len(query.Params) > 0 {
		sn = sn.Where(query.SQL(), query.Params...)
	}
	sn.Count(&total)
	err = sn.Offset(query.Offset).Limit(query.Limit).Preload(clause.Associations).Find(&list).Error
	return
}

func (u *UserKey) Create(uk *model.UserKey) (*model.UserKey, error) {
	if _, err := u.Find(uk.Uid, uk.Name); err == nil {
		return nil, fmt.Errorf("userKey already exist: %s", uk.Name)
	}

	if err := gdb.Create(uk).Error; err != nil {
		return nil, err
	}

	return uk, nil
}

func (u *UserKey) Update(user *model.UserKey) error {
	return gdb.Save(user).Error
}

func (u *UserKey) Delete(user *model.UserKey) error {
	return gdb.Delete(user).Error
}
