package service

import (
	"fmt"
	"strings"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func MatterExist(uid int64, name, parent string) bool {
	return !gormutil.DB().Where("uid=? and name=? and parent=?", uid, name, parent).First(&model.Matter{}).RecordNotFound()
}

func MatterParentExist(uid int64, parentDir string) bool {
	if parentDir == "" {
		return true
	}

	// parent matter exist, eg: test123/234/
	items := strings.Split(parentDir, "/")
	name := items[len(items)-2]                       // -> 234
	parent := strings.TrimSuffix(parentDir, name+"/") // -> test123/
	if MatterExist(uid, name, parent) {
		return true
	}

	return false
}

func FileGet(alias string) (*model.Matter, error) {
	m := new(model.Matter)
	if gormutil.DB().First(m, "alias=?", alias).RecordNotFound() {
		return nil, fmt.Errorf("file not exist")
	}

	return m, nil
}

func UserFileGet(uid int64, alias string) (*model.Matter, error) {
	m, err := FileGet(alias)
	if err != nil {
		return nil, err
	} else if m.Uid != uid {
		return nil, fmt.Errorf("file not belong to you")
	}

	return m, nil
}

var docTypes = []string{
	"text/csv",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

type Matter struct {
	query  string
	params []interface{}
}

func NewMatter(uid int64) *Matter {
	return &Matter{
		query:  "uid=? and dirtype!=? and uploaded != 0",
		params: []interface{}{uid, model.DirTypeSys},
	}
}

func (m *Matter) SetDir(dir string) {
	m.query += " and parent=?"
	m.params = append(m.params, dir)
}

func (m *Matter) SetType(mt string) {
	if mt == "doc" {
		m.query += " and `type` in ('" + strings.Join(docTypes, "','") + "')"
	} else if mt != "" {
		m.query += " and type like ?"
		m.params = append(m.params, mt+"%")
	}
}

func (m *Matter) Find(offset, limit int) (list []model.Matter, total int64, err error) {
	sn := gormutil.DB().Where(m.query, m.params...)
	sn.Model(model.Matter{}).Count(&total)
	sn = sn.Order("dirtype desc")
	err = sn.Offset(offset).Limit(limit).Find(&list).Error
	return
}

func DirRename(src *model.Matter, name string) error {
	oldParent := fmt.Sprintf("%s%s/", src.Parent, src.Name)
	newParent := fmt.Sprintf("%s%s/", src.Parent, name)
	list := make([]model.Matter, 0)
	gormutil.DB().Where("parent like '" + oldParent + "%'").Find(&list)

	fc := func(tx *gorm.DB) error {
		for _, v := range list {
			parent := strings.Replace(v.Parent, oldParent, newParent, 1)
			if err := tx.Model(v).Update("parent", parent).Error; err != nil {
				return err
			}
		}

		if err := tx.Model(src).Update("name", name).Error; err != nil {
			return err
		}

		return nil
	}

	return gormutil.DB().Transaction(fc)
}
