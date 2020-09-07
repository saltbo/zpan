package service

import (
	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

const defaultSize = 50 << 20

var iss uint64 = defaultSize

func UserStorageInit(storage uint64) {
	iss = storage
}

func UserFind(ux string) (*model.User, error) {
	user := new(model.User)
	if gormutil.DB().First(user, "ux=?", ux).RecordNotFound() {
		return userCreate(ux)
	}

	return user, nil
}

func userCreate(ux string) (*model.User, error) {
	user := &model.User{
		Ux:         ux,
		StorageMax: iss,
	}

	fc := func(tx *gorm.DB) error {
		if err := tx.Create(user).Error; err != nil {
			return err
		}

		return MatterSysInit(tx, user.Id, ".pics")
	}

	return user, gormutil.DB().Transaction(fc)
}
