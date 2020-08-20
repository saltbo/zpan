package rest

import (
	"fmt"

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
	router.POST("/files", f.create)
	router.PATCH("/files", f.patch) // todo 如何符合restful规范？
	router.DELETE("/files/:alias", f.delete)

	router.GET("/folders", f.findFolders)
	router.POST("/folders", f.createFolder)
}

func (f *FileResource) findAll(c *gin.Context) {
	p := new(bind.QueryFiles)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	sm := service.NewMatter(moreu.GetUserId(c))
	if !p.Search {
		sm.SetDir(p.Dir)
	} else if p.Type != "" {
		sm.SetType(p.Type)
	}
	list, total, err := sm.Find(p.Offset, p.Limit)
	if err != nil {
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
	sn := gormutil.DB().Where(query, moreu.GetUserId(c), model.DirTypeUser, p.Parent)
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
	if service.DirNotExist(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("direction %s not exist", p.Dir))
		return
	}

	if err := gormutil.DB().Create(p.ToMatter(uid)).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (f *FileResource) create(c *gin.Context) {
	p := new(bind.BodyFile)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}
	// todo add valid for the callback

	if !gormutil.DB().First(&model.Matter{}, "object=?", p.Object).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("object %s already exist", p.Object))
		return
	}

	fc := func(tx *gorm.DB) error {
		if err := tx.Create(p.ToMatter()).Error; err != nil {
			return err
		}

		// update the service
		storage := new(model.Storage)
		if gormutil.DB().First(storage, "user_id=?", p.Uid).RecordNotFound() {
			return fmt.Errorf("storage not exist")
		}

		if err := tx.Model(storage).Update("used", gorm.Expr("used+?", p.Size)).Error; err != nil {
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

func (f *FileResource) patch(c *gin.Context) {
	p := new(bind.BodyFileOperation)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := service.UserFileGet(moreu.GetUserId(c), p.Alias)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	switch p.Action {
	case OPERATION_COPY:
		err = service.FileCopy(file, p.Dest)
	case OPERATION_MOVE:
		err = service.FileMove(file, p.Dest)
	case OPERATION_RENAME:
		if file.DirType > 0 {
			if err := service.DirRename(file, p.Dest); err != nil {
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
		err = service.FileRename(file, p.Dest)
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
	file, err := service.UserFileGet(uid, c.Param("alias"))
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

		// update the user storage
		storage := new(model.Storage)
		if gormutil.DB().First(storage, "user_id=?", uid).RecordNotFound() {
			return fmt.Errorf("BUG: storage not exist")
		}

		if err := tx.Model(storage).Update("used", gorm.Expr("used-?", file.Size)).Error; err != nil {
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
