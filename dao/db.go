package dao

import (
	"log"

	"github.com/saltbo/zpan/model"

	_ "github.com/go-sql-driver/mysql"
	"github.com/go-xorm/xorm"
)

var DB *xorm.Engine

func Init(dsn string) {
	db, err := xorm.NewEngine("mysql", dsn)
	if err != nil {
		log.Fatalln(err)
	}
	db.ShowSQL(true)

	models := []interface{}{
		new(model.User),
		new(model.Share),
		new(model.Matter),
	}
	if err := db.Sync2(models...); err != nil {
		log.Fatalln(err)
	}

	DB = db
}
