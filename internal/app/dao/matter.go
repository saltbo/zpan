package dao

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/saltbo/zpan/internal/app/model"
)

type Matter struct {
}

var lock sync.Mutex

func NewMatter() *Matter {
	return &Matter{}
}

func (ms *Matter) Exist(uid int64, name, parent string) (*model.Matter, bool) {
	m := new(model.Matter)
	err := gdb.Where("uid=? and name=? and parent=?", uid, name, parent).First(m).Error
	return m, !errors.Is(err, gorm.ErrRecordNotFound)
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

func (ms *Matter) FindAll(query *Query) (list []model.Matter, total int64, err error) {
	sn := gdb.Where(query.SQL()+" and uploaded_at is not null", query.Params...)
	sn.Model(model.Matter{}).Count(&total)
	sn = sn.Order("dirtype desc")
	err = sn.Offset(query.Offset).Limit(query.Limit).Find(&list).Error
	return
}

func (ms *Matter) FindChildren(uid int64, parent string) (children []model.Matter, err error) {
	err = gdb.Debug().Where("uid=? and parent like ?", uid, parent+"%").Find(&children).Error
	return
}

func (ms *Matter) UnscopedChildren(uid int64, recycleAlias string) (children []model.Matter, err error) {
	err = gdb.Unscoped().Where("uid=? and trashed_by=?", uid, recycleAlias).Find(&children).Error
	return
}

func (ms *Matter) Create(matter *model.Matter) error {
	lock.Lock()
	defer lock.Unlock()
	if _, ok := ms.Exist(matter.Uid, matter.Name, matter.Parent); ok {
		return fmt.Errorf("matter already exist")
	}

	if !ms.ParentExist(matter.Uid, matter.Parent) {
		return fmt.Errorf("parent dir not exist")
	}

	return gdb.Create(matter).Error
}

func (ms *Matter) Find(alias string) (*model.Matter, error) {
	m := new(model.Matter)
	if err := gdb.First(m, "alias=?", alias).Error; errors.Is(err, gorm.ErrRecordNotFound) {
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

func (ms *Matter) Uploaded(matter *model.Matter, incrUsed bool) error {
	fc := func(tx *gorm.DB) error {
		if err := tx.First(matter).Where("uploaded_at is null").Update("uploaded_at", time.Now()).Error; err != nil {
			return err
		}

		if !incrUsed {
			return nil
		}

		// update the storage used of the user
		expr := gorm.Expr("used+?", matter.Size)
		return tx.Model(&model.UserStorage{}).Where("uid=?", matter.Uid).Update("used", expr).Error
	}

	return gdb.Transaction(fc)
}

func (ms *Matter) Rename(alias, name string) error {
	m := gdb.Model(&model.Matter{})
	return m.Where("alias=?", alias).Update("name", name).Error
}

func (ms *Matter) Move(alias, parent string) error {
	m := gdb.Model(&model.Matter{})
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

func (ms *Matter) Remove(mid int64, trashedBy string) error {
	deletedAt := gorm.DeletedAt{Time: time.Now(), Valid: true}
	values := model.Matter{TrashedBy: trashedBy, DeletedAt: deletedAt}
	return gdb.Model(&model.Matter{Id: mid}).Updates(values).Error
}

func (ms *Matter) RemoveToRecycle(m *model.Matter) error {
	// soft delete the matter
	if err := ms.Remove(m.Id, m.Alias); err != nil {
		return err
	}

	// create a recycle record
	rm := &model.Recycle{
		Uid:     m.Uid,
		Sid:     m.Sid,
		Alias:   m.Alias,
		Name:    m.Name,
		Type:    m.Type,
		Size:    m.Size,
		DirType: m.DirType,
		Parent:  m.Parent,
		Object:  m.Object,
	}
	return gdb.Create(rm).Error
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

	return gdb.Debug().Transaction(fc)
}

func (ms *Matter) RenameChildren(m *model.Matter, newName string) error {
	children, err := ms.FindChildren(m.Uid, m.FullPath())
	if err != nil {
		return err
	}

	oldParent := fmt.Sprintf("%s%s/", m.Parent, m.Name)
	newParent := fmt.Sprintf("%s%s/", m.Parent, newName)
	fc := func(tx *gorm.DB) error {
		for _, v := range children {
			parent := strings.Replace(v.Parent, oldParent, newParent, 1)
			if err := tx.Model(v).Update("parent", parent).Error; err != nil {
				return err
			}
		}

		return nil
	}

	return gdb.Transaction(fc)
}
