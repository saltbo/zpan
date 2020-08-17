package service

import (
	"fmt"

	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func StorageQuotaVerify(uid, addonSize int64) error {
	storage := new(model.Storage)
	if err := gormutil.DB().First(storage, "user_id=?", uid).Error; err != nil {
		return err
	} else if storage.Used+uint64(addonSize) >= storage.Max {
		return fmt.Errorf("service not enough space")
	}

	return nil
}
