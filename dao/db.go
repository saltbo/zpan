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

func FileGet(uid int64, fileId interface{}) (*model.Matter, error) {
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

func FileInsert(file *model.Matter) error {
	_, err := DB.Insert(file)
	return err
}

func FileMove(id int64, dest string) error {
	_, err := DB.ID(id).Cols("parent").Update(&model.Matter{Parent: dest})
	return err
}

func FileRename(id int64, name string) error {
	_, err := DB.ID(id).Cols("name").Update(&model.Matter{Name: name})
	return err
}
