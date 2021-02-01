package dao

import (
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/gormutil"
)

func Init(driver, dsn string) {
	gormutil.Init(gormutil.Config{
		Driver: driver,
		DSN:    dsn,
	}, true)
	gormutil.AutoMigrate(model.Tables())
}
