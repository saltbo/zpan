package service

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/saltbo/gopkg/timeutil"

	"github.com/saltbo/zpan/pkg/gormutil"

	"github.com/saltbo/zpan/dao/matter"
	"github.com/saltbo/zpan/model"
)

type File struct {
	matter.Matter

	sStorage *Storage
}

func NewFile() *File {
	return &File{
		sStorage: NewStorage(),
	}
}

func (f *File) FindAll(uid, sid int64, offset, limit int, options ...matter.QueryOption) (list []model.Matter, total int64, err error) {
	provider, err := f.sStorage.GetProvider(sid)
	if err != nil {
		return list, total, err
	}

	options = append(options, matter.WithSid(sid))
	list, total, err = f.Matter.FindAll(uid, offset, limit, options...)
	for idx := range list {
		list[idx].SetURL(provider.PublicURL)
	}
	return
}

func (f *File) PreSignPutURL(matter *model.Matter) (url string, headers http.Header, err error) {
	if !f.ParentExist(matter.Uid, matter.Parent) {
		return "", nil, fmt.Errorf("dir does not exists")
	}

	//	auto append a suffix if matter exist
	if _, ok := f.Exist(matter.Uid, matter.Name, matter.Parent); ok {
		ext := filepath.Ext(matter.Name)
		name := strings.TrimSuffix(matter.Name, ext)
		suffix := fmt.Sprintf("_%s", timeutil.Format(time.Now(), "YYYYMMDD_HHmmss"))
		matter.Name = name + suffix + ext
	}

	provider, err := f.sStorage.GetProvider(matter.Sid)
	if err != nil {
		return "", nil, err
	}

	url, headers, err = provider.SignedPutURL(matter.Object, matter.Type, matter.Public())
	if err != nil {
		return
	}

	err = f.Create(matter)
	return
}

func (f *File) UploadDone(uid int64, alias string) (*model.Matter, error) {
	if err := f.Matter.Uploaded(alias); err != nil {
		return nil, err
	}

	m, err := f.FindUserMatter(uid, alias)
	if err != nil {
		return nil, err
	}

	provider, err := f.sStorage.GetProvider(m.Sid)
	if err != nil {
		return nil, err
	}

	m.SetURL(provider.PublicURL)
	return m, nil
}

func (f *File) PreSignGetURL(alias string) (string, error) {
	m, err := f.Find(alias)
	if err != nil {
		return "", err
	}

	provider, err := f.sStorage.GetProvider(m.Sid)
	if err != nil {
		return "", err
	}

	return provider.SignedGetURL(m.Object, m.Name)
}

func (f *File) Rename(uid int64, alias, name string) error {
	m, err := f.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	if _, ok := f.Exist(uid, name, m.Parent); ok {
		return fmt.Errorf("dir already has the same name file")
	}

	return f.Matter.Rename(alias, name)
}

func (f *File) Copy(uid int64, alias, parent string) error {
	m, err := f.FindUserMatter(uid, alias)
	if err != nil {
		return err
	} else if err := f.copyOrMoveValidation(m, uid, parent); err != nil {
		return err
	}

	return f.Matter.Copy(alias, parent)
}

func (f *File) Move(uid int64, alias, parent string) error {
	m, err := f.FindUserMatter(uid, alias)
	if err != nil {
		return err
	} else if err := f.copyOrMoveValidation(m, uid, parent); err != nil {
		return err
	}

	return f.Matter.Move(alias, parent)
}

func (f *File) Delete(uid int64, alias string) error {
	_, err := f.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	return f.Matter.RemoveToRecycle(gormutil.DB(), alias)
}

func (f *File) copyOrMoveValidation(m *model.Matter, uid int64, parent string) error {
	if m.IsDir() {
		return fmt.Errorf("only support file")
	} else if parent == m.Parent {
		return fmt.Errorf("file already in the dir")
	} else if !f.ParentExist(uid, parent) {
		return fmt.Errorf("dir does not exists")
	}

	if _, ok := f.Exist(m.Uid, m.Name, parent); ok {
		return fmt.Errorf("dir already has the same name file")
	}

	return nil
}
