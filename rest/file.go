package rest

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"
	moreu "github.com/saltbo/moreu/client"

	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/service"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
)

var docTypes = []string{
	"text/csv",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

const (
	DIRTYPE_SYS = iota + 1
	DIRTYPE_USER
)

const (
	OPERATION_COPY = iota + 1
	OPERATION_MOVE
	OPERATION_RENAME
)

type FileResource struct {
	bucketName string
	provider   disk.Provider
}

func NewFileResource(bucketName string, provider disk.Provider) ginutil.Resource {
	return &FileResource{
		bucketName: bucketName,
		provider:   provider,
	}
}

func (f *FileResource) Register(router *gin.RouterGroup) {
	router.GET("/files", f.findAll)
	router.POST("/files/callback", f.fileCallback)
	router.POST("/files/operation", f.fileOperation)
	router.DELETE("/files/:id", f.delete)

	router.GET("/folders", f.findFolders)
	router.POST("/folders", f.createFolder)
}

func (f *FileResource) findAll(c *gin.Context) {
	p := new(bind.QueryFiles)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list := make([]model.Matter, 0)
	query := "uid=? and dirtype!=?"
	params := []interface{}{moreu.GetUserId(c), DIRTYPE_SYS}
	if !p.Search {
		query += " and parent=?"
		params = append(params, p.Dir)
	}
	if p.Type == "doc" {
		query += " and `type` in ('" + strings.Join(docTypes, "','") + "')"
	} else if p.Type != "" {
		query += " and type like ?"
		params = append(params, p.Type+"%")
	}

	var total int64
	sn := gormutil.DB().Debug().Where(query, params...)
	sn.Model(model.Matter{}).Count(&total)
	sn = sn.Order("dirtype desc")
	if err := sn.Limit(p.Limit).Offset(p.Offset).Find(&list).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (f *FileResource) findFolders(c *gin.Context) {
	p := new(bind.QueryFolder)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	var total int64
	list := make([]model.Matter, 0)
	query := "uid=? and dirtype=? and parent=?"
	sn := gormutil.DB().Where(query, moreu.GetUserId(c), DIRTYPE_USER, p.Parent)
	sn.Model(model.Matter{}).Count(&total)
	if err := sn.Limit(p.Limit).Offset(p.Offset).Find(&list).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (f *FileResource) createFolder(c *gin.Context) {
	p := new(bind.BodyFolder)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := moreu.GetUserId(c)
	if !service.DirExist(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("direction %s not exist", p.Dir))
		return
	}

	m := &model.Matter{
		Uid:     uid,
		Dirtype: DIRTYPE_USER,
		Name:    p.Name,
		Parent:  p.Dir,
	}
	if err := gormutil.DB().Create(m).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (f *FileResource) fileCallback(c *gin.Context) {
	p := new(bind.BodyFile)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	storage := new(model.Storage)
	if gormutil.DB().First(storage, "user_id=?", p.Uid).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("storage not exist"))
		return
	}

	if !gormutil.DB().First(&model.Matter{}, "object=?", p.Object).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("object %s already exist", p.Object))
		return
	}

	fc := func(tx *gorm.DB) error {
		m := &model.Matter{
			Uid:    p.Uid,
			Name:   p.Name,
			Type:   p.Type,
			Size:   p.Size,
			Parent: p.Dir,
			Object: p.Object,
		}
		if err := tx.Create(m).Error; err != nil {
			return err
		}

		// update the service todo add lock for concurrent
		storageUsed := storage.Used + uint64(p.Size)
		if err := tx.Model(storage).Update("used", storageUsed).Error; err != nil {
			return err
		}

		return nil
	}
	if err := gormutil.DB().Transaction(fc); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (f *FileResource) fileOperation(c *gin.Context) {
	p := new(bind.BodyFileOperation)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := service.FileGet(moreu.GetUserId(c), p.Id)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	switch p.Action {
	case OPERATION_COPY:
		err = service.FileCopy(file, p.Dest)
	case OPERATION_MOVE:
		err = service.FileMove(file.Id, p.Dest)
	case OPERATION_RENAME:
		if file.Dirtype > 0 {
			if err := service.DirRename(file.Id, p.Dest); err != nil {
				ginutil.JSONServerError(c, err)
				return
			}

			ginutil.JSON(c)
			return
		}

		err = f.provider.TagRename(f.bucketName, file.Object, p.Dest)
		if err != nil {
			ginutil.JSONServerError(c, err)
			return
		}
		err = service.FileRename(file.Id, p.Dest)
	default:
		err = fmt.Errorf("invalid operation")
	}

	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (f *FileResource) delete(c *gin.Context) {
	uid := moreu.GetUserId(c)
	fileId := c.Param("id")

	storage := new(model.Storage)
	if gormutil.DB().First(storage, "user_id=?", uid).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("storage not exist"))
		return
	}

	file, err := service.FileGet(uid, fileId)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := f.provider.DeleteObject(f.bucketName, file.Object); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	fc := func(tx *gorm.DB) error {
		// delete for the list
		if err := tx.Delete(file).Error; err != nil {
			return err
		}

		// update the user service todo add lock for concurrent
		storageUsed := storage.Used - uint64(file.Size)
		if err := tx.Model(storage).Update("used", storageUsed).Error; err != nil {
			return err
		}

		return nil
	}

	if err := gormutil.DB().Transaction(fc); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
