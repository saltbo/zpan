package dao

import (
	"github.com/saltbo/zpan/pkg/gormutil"

	"github.com/saltbo/zpan/model"
)

const defaultSize = 50 << 20

type User struct {
}

func NewUser() *User {
	return &User{}
}

func (u *User) Create(ux string) (*model.User, error) {
	user := &model.User{Ux: ux, StorageMax: defaultSize}
	if err := gormutil.DB().Create(user).Error; err != nil {
		return nil, err
	}

	return user, nil
}

func (u *User) Find(uid int64) (*model.User, error) {
	user := new(model.User)
	if err := gormutil.DB().First(user, model.User{Id: uid}).Error; err != nil {
		return nil, err
	}

	return user, nil
}

func (u User) FindByUx(ux string) (*model.User, error) {
	user := &model.User{Ux: ux}
	if err := gormutil.DB().First(user).Error; err != nil {
		return nil, err
	}

	return user, nil
}

func (u *User) FindAll(uxs ...string) (rets []model.User, err error) {
	rets = make([]model.User, 0)
	err = gormutil.DB().Where("ux in (?)", uxs).Find(&rets).Error
	return
}

func (u *User) StoragePatch(id int64, max uint64) error {
	return gormutil.DB().Model(&model.User{Id: id}).Update("storage_max", max).Error
}
