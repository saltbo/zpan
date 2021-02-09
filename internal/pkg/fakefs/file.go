package fakefs

import (
	"fmt"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
)

type File struct {
	dMatter *dao.Matter
}

func NewFile() *File {
	return &File{
		dMatter: dao.NewMatter(),
	}
}

func (f *File) Rename(uid int64, alias, name string) error {
	m, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	if _, ok := f.dMatter.Exist(uid, name, m.Parent); ok {
		return fmt.Errorf("dir already has the same name file")
	}

	return f.dMatter.Rename(alias, name)
}

func (f *File) Copy(uid int64, alias, parent string) error {
	m, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	} else if err := f.copyOrMoveValidation(m, uid, parent); err != nil {
		return err
	}

	return f.dMatter.Copy(alias, parent)
}

func (f *File) Move(uid int64, alias, parent string) error {
	m, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	} else if err := f.copyOrMoveValidation(m, uid, parent); err != nil {
		return err
	}

	return f.dMatter.Move(alias, parent)
}

func (f *File) Delete(uid int64, alias string) error {
	_, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	return f.dMatter.RemoveToRecycle(alias)
}

func (f *File) copyOrMoveValidation(m *model.Matter, uid int64, parent string) error {
	if m.IsDir() {
		return fmt.Errorf("only support file")
	} else if parent == m.Parent {
		return fmt.Errorf("file already in the dir")
	} else if !f.dMatter.ParentExist(uid, parent) {
		return fmt.Errorf("dir does not exists")
	}

	if _, ok := f.dMatter.Exist(m.Uid, m.Name, parent); ok {
		return fmt.Errorf("dir already has the same name file")
	}

	return nil
}
