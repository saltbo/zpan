package matter

import (
	"fmt"
	"strings"
	"time"

	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

func Init(tx *gorm.DB, uid int64, name string) error {
	matter := model.NewMatter(uid, name)
	matter.DirType = model.DirTypeSys
	return tx.Create(matter).Error
}

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

func (ms *Matter) UnscopedChildren(uid int64, parent string) (children []model.Matter, err error) {
	err = gormutil.DB().Unscoped().Where("uid=? and parent like ?", uid, parent+"%").Find(&children).Error
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

func (ms *Matter) Remove(db *gorm.DB, alias string) error {
	m, err := ms.Find(alias)
	if err != nil {
		return err
	}

	return db.Delete(m).Error
}

func (ms *Matter) RemoveToRecycle(db *gorm.DB, alias string) error {
	m, err := ms.Find(alias)
	if err != nil {
		return err
	}

	fc := func(tx *gorm.DB) error {
		// delete for the list
		if err := tx.Delete(m).Error; err != nil {
			return err
		}

		// create a recycle record
		rm := &model.Recycle{
			Uid:     m.Uid,
			Alias:   m.Alias,
			Name:    m.Name,
			Type:    m.Type,
			Size:    m.Size,
			DirType: m.DirType,
		}
		return tx.Create(rm).Error
	}

	return db.Transaction(fc)
}

func (ms *Matter) Recovery(m *model.Matter) error {
	fc := func(tx *gorm.DB) error {
		if m.IsDir() {
			// remove the delete tag for the children
			sn := tx.Model(&model.Matter{}).Where("uid=? and parent=?", m.Uid, m.FullPath())
			if err := sn.Unscoped().Update("deleted_at", nil).Error; err != nil {
				return err
			}
		}

		// remove the delete tag
		sn := tx.Unscoped().Model(&model.Matter{}).Where("uid=? and alias=?", m.Uid, m.Alias)
		if err := sn.Update("deleted_at", nil).Error; err != nil {
			return err
		}

		// delete the recycle record
		return tx.Delete(&model.Recycle{}, "alias=?", m.Alias).Error
	}

	return gormutil.DB().Debug().Transaction(fc)
}
