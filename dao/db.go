package dao

import (
	"github.com/go-xorm/xorm"
	"log"
)

var DB *xorm.Engine

func Init(dsn string) {
	db, err := xorm.NewEngine("mysql", dsn)
	if err != nil {
		log.Fatalln(err)
	}

	DB = db
}
