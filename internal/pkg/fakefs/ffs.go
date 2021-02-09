package fakefs

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/saltbo/gopkg/timeutil"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/app/service"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

type FakeFS struct {
	dMatter *dao.Matter

	sFile    *File
	sFolder  *Folder
	sStorage *service.Storage
}

func New() *FakeFS {
	return &FakeFS{
		dMatter: dao.NewMatter(),

		sFile:    NewFile(),
		sFolder:  NewFolder(),
		sStorage: service.NewStorage(),
	}
}

func (fs *FakeFS) List(uid int64, qp *bind.QueryFiles) (list []model.Matter, total int64, err error) {
	query := dao.NewQuery()
	query.WithEq("sid", qp.Sid)
	query.WithEq("uid", uid)
	if qp.Type == "doc" {
		docTypes := "'" + strings.Join(model.DocTypes, "','") + "'"
		query.WithIn("type", docTypes)
	} else if qp.Type != "" {
		query.WithLike("type", qp.Type)
	} else if qp.Keyword != "" {
		query.WithLike("name", qp.Keyword)
	} else {
		query.WithEq("parent", qp.Dir)
	}
	query.Limit = qp.Limit
	query.Offset = qp.Offset
	return fs.dMatter.FindAll(query)
}

func (fs *FakeFS) PreSignPutURL(matter *model.Matter) (url string, headers http.Header, err error) {
	if !fs.dMatter.ParentExist(matter.Uid, matter.Parent) {
		return "", nil, fmt.Errorf("dir does not exists")
	}

	//	auto append a suffix if matter exist
	if _, ok := fs.dMatter.Exist(matter.Uid, matter.Name, matter.Parent); ok {
		ext := filepath.Ext(matter.Name)
		name := strings.TrimSuffix(matter.Name, ext)
		suffix := fmt.Sprintf("_%s", timeutil.Format(time.Now(), "YYYYMMDD_HHmmss"))
		matter.Name = name + suffix + ext
	}

	storage, err := fs.sStorage.Get(matter.Sid)
	if err != nil {
		return "", nil, err
	}

	matter.BuildObject(storage.RootPath, storage.FilePath)
	provider, err := fs.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return "", nil, err
	}

	url, headers, err = provider.SignedPutURL(matter.Object, matter.Type, storage.PublicRead())
	if err != nil {
		return
	}

	err = fs.dMatter.Create(matter)
	return
}

func (fs *FakeFS) UploadDone(uid int64, alias string) (*model.Matter, error) {
	m, err := fs.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return nil, err
	}

	if err := fs.dMatter.Uploaded(alias); err != nil {
		return nil, err
	}

	link, err := fs.BuildGetURL(alias)
	if err != nil {
		return nil, err
	}

	m.URL = link
	return m, nil
}

func (fs *FakeFS) BuildGetURL(alias string) (string, error) {
	m, err := fs.dMatter.Find(alias)
	if err != nil {
		return "", err
	}

	storage, err := fs.sStorage.Get(m.Sid)
	if err != nil {
		return "", err
	}

	provider, err := fs.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return "", err
	}

	if storage.PublicRead() {
		return provider.PublicURL(m.Object), nil
	}

	return provider.SignedGetURL(m.Object, m.Name)
}

func (fs *FakeFS) Copy(uid int64, alias, newPath string) error {
	m, err := fs.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	if _, ok := fs.dMatter.Exist(uid, m.Name, newPath); ok {
		return fmt.Errorf("dir already has the same name file")
	}

	if m.IsDir() {
		return fmt.Errorf("not support to copy a folder")
	}

	return fs.sFile.Copy(uid, alias, newPath)
}

func (fs *FakeFS) Move(uid int64, alias, newPath string) error {
	m, err := fs.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	if _, ok := fs.dMatter.Exist(uid, m.Name, newPath); ok {
		return fmt.Errorf("dir already has the same name file")
	}

	if m.IsDir() {
		return fs.sFolder.Move(uid, alias, newPath)
	}

	return fs.sFile.Move(uid, alias, newPath)
}

func (fs *FakeFS) Rename(uid int64, alias, name string) error {
	m, err := fs.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	if _, ok := fs.dMatter.Exist(uid, name, m.Parent); ok {
		return fmt.Errorf("dir already has the same name file")
	}

	if m.IsDir() {
		return fs.sFolder.Rename(uid, alias, name)
	}

	return fs.sFile.Rename(uid, alias, name)
}

func (fs *FakeFS) Delete(uid int64, alias string) error {
	m, err := fs.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	if m.IsDir() {
		return fs.sFolder.Remove(uid, alias)
	}

	return fs.sFile.Delete(uid, alias)
}
