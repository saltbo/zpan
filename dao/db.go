package dao

import (
	"fmt"
	_ "github.com/go-sql-driver/mysql"
	"github.com/go-xorm/xorm"
	"log"
	"zpan/model"
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
		new(model.Rtoken),
		new(model.Share),
		new(model.Matter),
	}
	if err := db.Sync2(models...); err != nil {
		log.Fatalln(err)
	}

	DB = db
}

func DirExist(uid int64, dir string) bool {
	if dir == "" {
		return true
	}

	exist, err := DB.Where("uid=? and object=?", uid, dir).Exist(&model.Matter{})
	if err != nil {
		log.Panicln(err)
	}

	return exist
}

func FileGet(uid int64, fileId string) (*model.Matter, error) {
	m := new(model.Matter)
	if exist, err := DB.Id(fileId).Get(m); err != nil {
		return nil, err
	} else if !exist {
		return nil, fmt.Errorf("file not exist.")
	} else if m.Uid != uid {
		return nil, fmt.Errorf("file not belong to you.")
	}

	return m, nil
}
