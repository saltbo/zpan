package fakefs

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
)

type Folder struct {
	dMatter *dao.Matter
}

func NewFolder() *Folder {
	return &Folder{
		dMatter: dao.NewMatter(),
	}
}

func (f *Folder) Create(matter *model.Matter) error {
	uploaded := time.Now()
	matter.UploadedAt = &uploaded
	return f.dMatter.Create(matter)
}

func (f *Folder) Rename(uid int64, alias, name string) error {
	m, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	if _, ok := f.dMatter.Exist(uid, name, m.Parent); ok {
		return fmt.Errorf("dir already exist a same name file")
	}

	children, err := f.dMatter.FindChildren(m.Uid, m.FullPath())
	if err != nil {
		return err
	}

	oldParent := fmt.Sprintf("%s%s/", m.Parent, m.Name)
	newParent := fmt.Sprintf("%s%s/", m.Parent, name)
	fc := func(tx *gorm.DB) error {
		for _, v := range children {
			parent := strings.Replace(v.Parent, oldParent, newParent, 1)
			if err := tx.Model(v).Update("parent", parent).Error; err != nil {
				return err
			}
		}

		if err := tx.Model(m).Update("name", name).Error; err != nil {
			return err
		}

		return nil
	}

	return dao.Transaction(fc)
}

func (f *Folder) Move(uid int64, alias, parent string) error {
	m, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	if err := f.copyOrMoveValidation(m, uid, parent); err != nil {
		return err
	}

	children, err := f.dMatter.FindChildren(m.Uid, m.FullPath())
	if err != nil {
		return err
	}

	fc := func(tx *gorm.DB) error {
		for _, v := range children {
			err := tx.Model(v).Update("parent", parent+m.Name+"/").Error
			if err != nil {
				return err
			}
		}

		return tx.Model(m).Update("parent", parent).Error
	}
	return dao.Transaction(fc)
}

func (f *Folder) Remove(uid int64, alias string) error {
	m, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	children, err := f.dMatter.FindChildren(m.Uid, m.FullPath())
	if err != nil {
		return err
	}

	fc := func(tx *gorm.DB) error {
		for _, v := range children {
			if err := f.dMatter.Remove(tx, v.Id, m.Alias); err != nil {
				return err
			}
		}

		return f.dMatter.RemoveToRecycle(m.Alias)
	}

	return dao.Transaction(fc)
}

func (f *Folder) copyOrMoveValidation(m *model.Matter, uid int64, parent string) error {
	if !m.IsDir() {
		return fmt.Errorf("only support direction")
	} else if parent == m.Parent {
		return fmt.Errorf("dir already in the dir")
	} else if parent != "" && strings.HasPrefix(parent, m.Parent+m.Name+"/") {
		return fmt.Errorf("can not move to itself")
	} else if !f.dMatter.ParentExist(uid, parent) {
		return fmt.Errorf("dir does not exists")
	}

	if _, ok := f.dMatter.Exist(m.Uid, m.Name, parent); ok {
		return fmt.Errorf("dir already has the same name file")
	}

	return nil
}
