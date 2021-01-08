package matter

import (
	"fmt"
	"strings"
	"time"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

type Matter struct {
}

func NewMatter() *Matter {
	return &Matter{}
}

func (ms *Matter) Exist(uid int64, name, parent string) (*model.Matter, bool) {
	m := new(model.Matter)
	return m, !gormutil.DB().Where("uid=? and name=? and parent=?", uid, name, parent).First(m).RecordNotFound()
}

func (ms *Matter) ParentExist(uid int64, parentDir string) bool {
	if parentDir == "" {
		return true
	}

	// parent matter exist, eg: test123/234/
	items := strings.Split(parentDir, "/")
	name := items[len(items)-2]                       // -> 234
	parent := strings.TrimSuffix(parentDir, name+"/") // -> test123/
	pm, exist := ms.Exist(uid, name, parent)
	if exist && pm.IsDir() {
		return true
	}

	return false
}

func (ms *Matter) FindAll(uid int64, offset, limit int, options ...QueryOption) (list []model.Matter, total int64, err error) {
	mq := NewQuery(uid, options...)
	sn := gormutil.DB().Where(mq.SQL, mq.Params...)
	sn.Model(model.Matter{}).Count(&total)
	sn = sn.Order("dirtype desc")
	err = sn.Offset(offset).Limit(limit).Find(&list).Error
	return
}

func (ms *Matter) FindChildren(uid int64, parent string) (children []model.Matter, err error) {
	err = gormutil.DB().Debug().Where("uid=? and parent like ?", uid, parent+"%").Find(&children).Error
	return
}

func (ms *Matter) UnscopedChildren(uid int64, recycleAlias string) (children []model.Matter, err error) {
	err = gormutil.DB().Unscoped().Where("uid=? and trashed_by=?", uid, recycleAlias).Find(&children).Error
	return
}

func (ms *Matter) Create(matter *model.Matter) error {
	if _, ok := ms.Exist(matter.Uid, matter.Name, matter.Parent); ok {
		return fmt.Errorf("matter already exist")
	}

	if !ms.ParentExist(matter.Uid, matter.Parent) {
		return fmt.Errorf("parent dir not exist")
	}

	fc := func(tx *gorm.DB) error {
		if err := tx.Create(matter).Error; err != nil {
			return err
		}

		// update the service
		expr := gorm.Expr("storage_used+?", matter.Size)
		if err := tx.Model(&model.User{Id: matter.Uid}).Update("storage_used", expr).Error; err != nil {
			return err
		}

		return nil
	}
	return gormutil.DB().Transaction(fc)
}

func (ms *Matter) Find(alias string) (*model.Matter, error) {
	m := new(model.Matter)
	if gormutil.DB().First(m, "alias=?", alias).RecordNotFound() {
		return nil, fmt.Errorf("file not exist")
	}

	return m, nil
}

func (ms *Matter) FindUserMatter(uid int64, alias string) (*model.Matter, error) {
	m, err := ms.Find(alias)
	if err != nil {
		return nil, err
	} else if !m.UserAccessible(uid) {
		return nil, fmt.Errorf("not accessible")
	}

	return m, nil
}

func (ms *Matter) Uploaded(alias string) error {
	m := gormutil.DB().Model(&model.Matter{})
	return m.Where("alias=?", alias).Update("uploaded_at", time.Now()).Error
}

func (ms *Matter) Rename(alias, name string) error {
	m := gormutil.DB().Model(&model.Matter{})
	return m.Where("alias=?", alias).Update("name", name).Error
}

func (ms *Matter) Move(alias, parent string) error {
	m := gormutil.DB().Model(&model.Matter{})
	return m.Where("alias=?", alias).Update("parent", parent).Error
}

func (ms *Matter) Copy(alias, parent string) error {
	m, err := ms.Find(alias)
	if err != nil {
		return err
	}

	nm := m.Clone()
	nm.Parent = parent
	return ms.Create(nm)
}

func (ms *Matter) Remove(db *gorm.DB, mid int64, trashedBy string) error {
	deletedAt := time.Now()
	values := model.Matter{TrashedBy: trashedBy, DeletedAt: &deletedAt}
	return db.Model(&model.Matter{Id: mid}).Updates(values).Error
}

func (ms *Matter) RemoveToRecycle(db *gorm.DB, alias string) error {
	m, err := ms.Find(alias)
	if err != nil {
		return err
	}

	fc := func(tx *gorm.DB) error {
		// soft delete the matter
		if err := ms.Remove(tx, m.Id, alias); err != nil {
			return err
		}

		// create a recycle record
		rm := &model.Recycle{
			Uid:     m.Uid,
			Sid:     m.Sid,
			Alias:   alias,
			Name:    m.Name,
			Type:    m.Type,
			Size:    m.Size,
			DirType: m.DirType,
			Parent:  m.Parent,
			Object:  m.Object,
		}
		return tx.Create(rm).Error
	}

	return db.Transaction(fc)
}

func (ms *Matter) Recovery(m *model.Recycle) error {
	fc := func(tx *gorm.DB) error {
		// remove the delete tag
		sn := tx.Model(&model.Matter{}).Where("uid=? and trashed_by=?", m.Uid, m.Alias)
		values := map[string]interface{}{"trashed_by": "", "deleted_at": nil}
		if err := sn.Unscoped().Updates(values).Error; err != nil {
			return err
		}

		// delete the recycle record
		return tx.Delete(&model.Recycle{}, "alias=?", m.Alias).Error
	}

	return gormutil.DB().Debug().Transaction(fc)
}
