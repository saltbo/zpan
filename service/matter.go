package service

import (
	"fmt"
	"strings"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func MatterSysInit(tx *gorm.DB, uid int64, name string) error {
	matter := model.NewMatter(uid, name)
	matter.DirType = model.DirTypeSys
	return tx.Create(matter).Error
}

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
		query:  "uid=? and (dirtype=? or (dirtype = 0 and uploaded_at is not null))",
		params: []interface{}{uid, model.DirTypeUser},
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

func (m *Matter) SetKeyword(kw string) {
	m.query += " and name like ?"
	m.params = append(m.params, fmt.Sprintf("%%%s%%",kw))
}

func (m *Matter) Find(offset, limit int) (list []model.Matter, total int64, err error) {
	sn := gormutil.DB().Where(m.query, m.params...)
	sn.Model(model.Matter{}).Count(&total)
	sn = sn.Order("dirtype desc")
	err = sn.Offset(offset).Limit(limit).Find(&list).Error
	return
}
