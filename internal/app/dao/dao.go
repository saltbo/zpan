package dao

import (
	"log"

	"github.com/saltbo/zpan/internal/app/repo/query"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/gormutil"
)

var gdb *gorm.DB

func Ready() bool {
	return gdb != nil
}

func Init(driver, dsn string) error {
	conf := gormutil.Config{
		Driver: driver,
		DSN:    dsn,
	}
	db, err := gormutil.New(conf)
	if err != nil {
		return err
	}

	gdb = db.Debug()
	if err := gdb.AutoMigrate(model.Tables()...); err != nil {
		return err
	}

	return nil
}

func GetDBQuery() *query.Query {
	if viper.IsSet("installed") {
		if err := Init(viper.GetString("database.driver"), viper.GetString("database.dsn")); err != nil {
			log.Fatalln(err)
		}
	}

	return query.Use(gdb)
}

func Transaction(fc func(tx *gorm.DB) error) error {
	return gdb.Transaction(fc)
}
