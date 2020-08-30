package rest

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/gopkg/timeutil"
	moreu "github.com/saltbo/moreu/client"

	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/service"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
)

type FileResource struct {
	provider disk.Provider
}

func NewFileResource(provider disk.Provider) ginutil.Resource {
	return &FileResource{
		provider: provider,
	}
}

func (rs *FileResource) Register(router *gin.RouterGroup) {
	router.POST("/files", rs.create)
	router.GET("/files", rs.findAll)
	router.GET("/files/:alias", rs.find)
	router.PATCH("/files/:alias/uploaded", rs.uploaded)
	router.PATCH("/files/:alias/name", rs.rename)
	router.PATCH("/files/:alias/location", rs.move)
	router.PATCH("/files/:alias/duplicate", rs.copy)
	router.DELETE("/files/:alias", rs.delete)
}

func (rs *FileResource) findAll(c *gin.Context) {
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

func (rs *FileResource) create(c *gin.Context) {
	p := new(bind.BodyFile)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := moreu.GetUserId(c)
	if err := service.StorageQuotaVerify(uid, p.Size); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if !service.MatterParentExist(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("parent dir not exist"))
		return
	}

	//	auto append a suffix if matter exist
	if service.MatterExist(uid, p.Name, p.Dir) {
		ext := filepath.Ext(p.Name)
		name := strings.TrimSuffix(p.Name, ext)
		suffix := fmt.Sprintf("_%s", timeutil.Format(time.Now(), "YYYYMMDD_HHmmss"))
		p.Name = name + suffix + ext
	}

	//publicRead := false
	//if p.Dir == ".pics/" {
	//	publicRead = true
	//}
	matter := p.ToMatter(uid)
	link, headers, err := rs.provider.PutPreSign(matter.Object, p.Type)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	fc := func(tx *gorm.DB) error {
		if err := tx.Create(matter).Error; err != nil {
			return err
		}

		// update the service
		storage := new(model.Storage)
		if gormutil.DB().First(storage, "user_id=?", uid).RecordNotFound() {
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

	ginutil.JSONData(c, gin.H{
		"alias":   matter.Alias,
		"link":    link,
		"object":  matter.Object,
		"headers": headers,
	})
}

func (rs *FileResource) find(c *gin.Context) {
	file, err := service.FileGet(c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	link, err := rs.provider.GetPreSign(file.Object, file.Name)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"link": link,
	})
}

func (rs *FileResource) uploaded(c *gin.Context) {
	file, err := service.UserFileGet(moreu.GetUserId(c), c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err = service.FileUploaded(file); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) rename(c *gin.Context) {
	p := new(bind.BodyFileRename)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := service.UserFileGet(moreu.GetUserId(c), c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if file.IsDir() {
		ginutil.JSONBadRequest(c, fmt.Errorf("not support rename the dir"))
		return
	}

	if err = service.FileRename(file, p.NewName); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) move(c *gin.Context) {
	p := new(bind.BodyFileMove)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := service.UserFileGet(moreu.GetUserId(c), c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err = service.FileMove(file, p.NewDir); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) copy(c *gin.Context) {
	p := new(bind.BodyFileCopy)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := service.UserFileGet(moreu.GetUserId(c), c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err = service.FileCopy(file, p.NewPath); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) delete(c *gin.Context) {
	uid := moreu.GetUserId(c)
	file, err := service.UserFileGet(uid, c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.provider.ObjectDelete(file.Object); err != nil {
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
