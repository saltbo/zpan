package gormutil

import (
	"log"

	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/driver/sqlserver"
	"gorm.io/gorm"
)

var defaultDB *gorm.DB

func Init(conf Config, debug bool) {
	defaultDB = New(conf, debug)
}

func AutoMigrate(models []interface{}) {
	defaultDB.AutoMigrate(models...)
}

func DB() *gorm.DB {
	return defaultDB
}

type Config struct {
	Driver string `yaml:"driver"`
	DSN    string `yaml:"dsn"`
}

func New(conf Config, debug bool) *gorm.DB {
	var director func(dsn string) gorm.Dialector
	switch conf.Driver {
	case "mysql":
		director = mysql.Open
	case "postgres":
		director = postgres.Open
	case "sqlserver":
		director = sqlserver.Open
	default:
		director = sqlite.Open
	}

	db, err := gorm.Open(director(conf.DSN), &gorm.Config{})
	if err != nil {
		log.Fatalln(err)
	}

	if debug {
		return db.Debug()
	}

	return db
}
