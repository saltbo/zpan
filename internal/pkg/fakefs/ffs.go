package fakefs

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

type FakeFS struct {
	dMatter *dao.Matter

	sFile   *File
	sFolder *Folder
}

func New() *FakeFS {
	return &FakeFS{
		dMatter: dao.NewMatter(),

		sFile:   NewFile(),
		sFolder: NewFolder(),
	}
}

func (fs *FakeFS) StartFileAutoDoneWorker() {
	go fs.sFile.RunFileAutoDoneWorker()
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

func (fs *FakeFS) CreateFile(m *model.Matter) (interface{}, error) {
	user, err := dao.NewUser().Find(m.Uid)
	if err != nil {
		return nil, err
	} else if user.Storage.Overflowed(m.Size) {
		return nil, fmt.Errorf("service not enough space")
	}

	link, headers, err := fs.sFile.PreSignPutURL(m)
	if err != nil {
		return nil, err
	}

	return gin.H{
		"alias":   m.Alias,
		"object":  m.Object,
		"link":    link,
		"headers": headers,
	}, nil
}

func (fs *FakeFS) CreateFolder(m *model.Matter) (interface{}, error) {
	err := fs.sFolder.Create(m)
	return m, err
}

func (fs *FakeFS) GetFileInfo(uid int64, alias string) (*model.Matter, error) {
	return fs.sFile.GetMatter(uid, alias)
}

func (fs *FakeFS) GetSaveRequest(uid int64, alias string) (interface{}, error) {
	m, err := fs.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return nil, err
	}

	return fs.sFile.BuildPutURL(m)
}

func (fs *FakeFS) TagUploadDone(uid int64, alias string) (*model.Matter, error) {
	return fs.sFile.UploadDone(uid, alias)
}
