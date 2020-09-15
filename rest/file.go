package rest

import (
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/gopkg/timeutil"

	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type FileResource struct {
	provider disk.Provider
}

func NewFileResource(conf disk.Config) ginutil.Resource {
	provider, err := disk.New(conf)
	if err != nil {
		log.Fatalln(err)
	}

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

	sm := service.NewMatter(userIdGet(c))
	if p.Type != "" {
		sm.SetType(p.Type)
	} else if p.Keyword != "" {
		sm.SetKeyword(p.Keyword)
	} else {
		sm.SetDir(p.Dir)
	}
	list, total, err := sm.Find(p.Offset, p.Limit)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	// inject the url for the public object
	for idx := range list {
		list[idx].SetURL(rs.provider.PublicURL)
	}

	ginutil.JSONList(c, list, total)
}

func (rs *FileResource) create(c *gin.Context) {
	p := new(bind.BodyFile)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	user := userGet(c)
	if user.StorageOverflowed(p.Size) {
		ginutil.JSONBadRequest(c, fmt.Errorf("service not enough space"))
		return
	}

	if !service.MatterParentExist(user.Id, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("parent dir not exist"))
		return
	}

	//	auto append a suffix if matter exist
	if service.MatterExist(user.Id, p.Name, p.Dir) {
		ext := filepath.Ext(p.Name)
		name := strings.TrimSuffix(p.Name, ext)
		suffix := fmt.Sprintf("_%s", timeutil.Format(time.Now(), "YYYYMMDD_HHmmss"))
		p.Name = name + suffix + ext
	}

	matter := p.ToMatter(user.Id)
	link, headers, err := rs.provider.SignedPutURL(matter.Object, p.Type, p.Public)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	fc := func(tx *gorm.DB) error {
		if err := tx.Create(matter).Error; err != nil {
			return err
		}

		// update the service
		expr := gorm.Expr("storage_used+?", p.Size)
		if err := tx.Model(user).Update("storage_used", expr).Error; err != nil {
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

	link, err := rs.provider.SignedGetURL(file.Object, file.Name)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"link": link,
	})
}

func (rs *FileResource) uploaded(c *gin.Context) {
	file, err := service.UserFileGet(userIdGet(c), c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err = service.FileUploaded(file); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	file.SetURL(rs.provider.PublicURL)
	ginutil.JSONData(c, file)
}

func (rs *FileResource) rename(c *gin.Context) {
	p := new(bind.BodyFileRename)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := service.UserFileGet(userIdGet(c), c.Param("alias"))
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
	uid := userIdGet(c)
	file, err := service.UserFileGet(uid, c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}
	//resolve issue #4
	if ok, err := service.CanMove(uid, p.NewDir, file); !ok {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if file.IsDir() {
		if err = service.FolderMove(file, p.NewDir); err != nil {
			ginutil.JSONServerError(c, err)
			return
		}
	} else {
		if err = service.FileMove(file, p.NewDir); err != nil {
			ginutil.JSONServerError(c, err)
			return
		}
	}

	ginutil.JSON(c)
}

func (rs *FileResource) copy(c *gin.Context) {
	p := new(bind.BodyFileCopy)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := service.UserFileGet(userIdGet(c), c.Param("alias"))
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
	user := userGet(c)
	file, err := service.UserFileGet(user.Id, c.Param("alias"))
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
		expr := gorm.Expr("storage_used-?", file.Size)
		if err := tx.Model(user).Update("storage_used", expr).Error; err != nil {
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
