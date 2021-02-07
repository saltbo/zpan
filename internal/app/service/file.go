package service

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/saltbo/gopkg/timeutil"

	"github.com/saltbo/zpan/internal/app/dao/matter"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/gormutil"
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
	options = append(options, matter.WithSid(sid))
	list, total, err = f.Matter.FindAll(uid, offset, limit, options...)
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

	storage, err := f.sStorage.Get(matter.Sid)
	if err != nil {
		return "", nil, err
	}

	matter.BuildObject(storage.RootPath, storage.FilePath)
	provider, err := f.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return "", nil, err
	}

	url, headers, err = provider.SignedPutURL(matter.Object, matter.Type, storage.PublicRead())
	if err != nil {
		return
	}

	err = f.Create(matter)
	return
}

func (f *File) UploadDone(uid int64, alias string) (*model.Matter, error) {
	m, err := f.FindUserMatter(uid, alias)
	if err != nil {
		return nil, err
	}

	if err := f.Matter.Uploaded(alias); err != nil {
		return nil, err
	}

	link, err := f.BuildGetURL(alias)
	if err != nil {
		return nil, err
	}

	m.URL = link
	return m, nil
}

func (f *File) BuildGetURL(alias string) (string, error) {
	m, err := f.Find(alias)
	if err != nil {
		return "", err
	}

	storage, err := f.sStorage.Get(m.Sid)
	if err != nil {
		return "", err
	}

	provider, err := f.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return "", err
	}

	if storage.PublicRead() {
		return provider.PublicURL(m.Object), nil
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
