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
	db, err := New(conf)
	if err != nil {
		log.Panicln(err)
	}

	if debug {
		db = db.Debug()
	}

	defaultDB = db
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

func New(conf Config) (*gorm.DB, error) {
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

	return gorm.Open(director(conf.DSN), &gorm.Config{})
}
