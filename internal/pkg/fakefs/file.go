package fakefs

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/timeutil"
	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/app/service"
	"github.com/saltbo/zpan/internal/pkg/provider"
)

type File struct {
	dMatter *dao.Matter

	sStorage   *service.Storage
	fileWaiter *FileWaiter
}

func NewFile() *File {
	return &File{
		dMatter: dao.NewMatter(),

		sStorage:   service.NewStorage(),
		fileWaiter: NewFileWaiter(),
	}
}

func (f *File) RunFileAutoDoneWorker() error {
	return f.fileWaiter.Run()
}

func (f *File) PreSignPutURL(matter *model.Matter) (url string, headers http.Header, err error) {
	if !f.dMatter.ParentExist(matter.Uid, matter.Parent) {
		return "", nil, fmt.Errorf("dir does not exists")
	}

	//	auto append a suffix if matter exist
	if _, ok := f.dMatter.Exist(matter.Uid, matter.Name, matter.Parent); ok {
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

	// 只有外链盘才有自动标记上传完成的逻辑
	if storage.Mode == model.StorageModeOutline {
		f.fileWaiter.Wait(provider, matter, f.UploadDone)
	}

	url, headers, err = provider.SignedPutURL(matter.Object, matter.Type, matter.Size, storage.PublicRead())
	if err != nil {
		return
	}

	err = f.dMatter.Create(matter)
	return
}

func (f *File) UploadDone(uid int64, alias string) (*model.Matter, error) {
	m, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return nil, err
	}

	s, err := f.sStorage.Get(m.Sid)
	if err != nil {
		return nil, err
	}

	if err := f.dMatter.Uploaded(m, s.Mode == model.StorageModeNetDisk); err != nil {
		return nil, err
	}

	return m, f.BuildGetURL(m)
}

func (f *File) PrepareMultipart(matter *model.Matter) (uid string, err error) {
	if !f.dMatter.ParentExist(matter.Uid, matter.Parent) {
		return "", fmt.Errorf("dir does not exists")
	}

	//	auto append a suffix if matter exist
	if _, ok := f.dMatter.Exist(matter.Uid, matter.Name, matter.Parent); ok {
		ext := filepath.Ext(matter.Name)
		name := strings.TrimSuffix(matter.Name, ext)
		suffix := fmt.Sprintf("_%s", timeutil.Format(time.Now(), "YYYYMMDD_HHmmss"))
		matter.Name = name + suffix + ext
	}

	storage, err := f.sStorage.Get(matter.Sid)
	if err != nil {
		return "", err
	}

	matter.BuildObject(storage.RootPath, storage.FilePath)
	provider, err := f.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return "", err
	}

	// TODO: 对外链盘自动标记上传完成的逻辑
	// if storage.Mode == model.StorageModeOutline {
	// 	f.fileWaiter.Wait(provider, matter, f.UploadDone)
	// }

	uid, err = provider.CreateMultipartUpload(matter.Object, matter.Type, storage.PublicRead())
	if err != nil {
		return
	}

	err = f.dMatter.Create(matter)
	return
}

func (f *File) PreSignMultipartPutURL(matter *model.Matter, uploadId string, partNumber, partSize int64) (url string, headers http.Header, err error) {
	storage, err := f.sStorage.Get(matter.Sid)
	if err != nil {
		return "", nil, err
	}
	provider, err := f.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return "", nil, err
	}
	return provider.SignedPartPutURL(matter.Object, uploadId, partSize, partNumber)
}

func (f *File) MultipartUploadDone(matter *model.Matter, uploadId string, parts provider.ObjectParts) error {
	storage, err := f.sStorage.Get(matter.Sid)
	if err != nil {
		return err
	}
	provider, err := f.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return err
	}
	return provider.CompleteMultipartUpload(matter.Object, uploadId, parts)
}

func (f *File) HasMultipartSupport(sid int64) bool {
	storage, err := f.sStorage.Get(sid)
	if err != nil {
		return false
	}
	provider, err := f.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return false
	}
	return provider.HasMultipartSupport()
}

func (f File) GetMatter(uid int64, alias string) (*model.Matter, error) {
	m, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return nil, err
	}

	return m, f.BuildGetURL(m)
}

func (f *File) BuildGetURL(m *model.Matter) error {
	storage, err := f.sStorage.Get(m.Sid)
	if err != nil {
		return err
	}

	provider, err := f.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return err
	}

	if storage.PublicRead() {
		m.URL = provider.PublicURL(m.Object)
		return nil
	}

	link, err := provider.SignedGetURL(m.Object, m.Name)
	m.URL = link
	return err
}

func (f *File) BuildPutURL(m *model.Matter) (interface{}, error) {
	storage, err := f.sStorage.Get(m.Sid)
	if err != nil {
		return nil, err
	}

	provider, err := f.sStorage.GetProviderByStorage(storage)
	if err != nil {
		return nil, err
	}

	link, headers, err := provider.SignedPutURL(m.Object, m.Type, m.Size, storage.PublicRead())
	if err != nil {
		return nil, err
	}

	return gin.H{"link": link, "headers": headers}, nil
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
	matter, err := f.dMatter.FindUserMatter(uid, alias)
	if err != nil {
		return err
	}

	storage, err := f.sStorage.Get(matter.Sid)
	if err != nil {
		return err
	}

	if storage.Mode == model.StorageModeNetDisk {
		return f.dMatter.RemoveToRecycle(matter)
	}

	return f.removeFromStorage(matter, storage)
}

func (f *File) removeFromStorage(m *model.Matter, s *model.Storage) error {
	provider, err := f.sStorage.GetProviderByStorage(s)
	if err != nil {
		return err
	}

	if err := provider.ObjectDelete(m.Object); err != nil {
		return err
	}

	return f.dMatter.Remove(m.Id, m.Alias)
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
