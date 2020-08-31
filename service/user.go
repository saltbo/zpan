package service

import (
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

const defaultSize = 50 << 20

var iss uint64 = defaultSize

func UserStorageInit(storage uint64) {
	iss = storage
}

func UserFind(ux string) (*model.User, error) {
	user := &model.User{
		Ux:         ux,
		StorageMax: iss,
	}
	if err := gormutil.DB().FirstOrCreate(user, "ux=?", user.Ux).Error; err != nil {
		return nil, err
	}

	return user, nil
}
