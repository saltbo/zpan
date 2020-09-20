package rest

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type FileResource struct {
	fs *service.File
	folder *service.Folder
}

func NewFileResource(conf disk.Config) ginutil.Resource {
	provider, err := disk.New(conf)
	if err != nil {
		log.Fatalln(err)
	}

	return &FileResource{
		fs: service.NewFile(provider),
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

	mq := service.NewMatterQuery(userIdGet(c))
	if p.Type != "" {
		mq.SetType(p.Type)
	} else if p.Keyword != "" {
		mq.SetKeyword(p.Keyword)
	} else {
		mq.SetDir(p.Dir)
	}
	list, total, err := rs.fs.FindAll(mq, p.Offset, p.Limit)
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

	user := userGet(c)
	if user.StorageOverflowed(p.Size) {
		ginutil.JSONBadRequest(c, fmt.Errorf("service not enough space"))
		return
	}

	matter := p.ToMatter(user.Id)
	link, headers, err := rs.fs.PreSignPutURL(matter)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"alias":   matter.Alias,
		"object":  matter.Object,
		"link":    link,
		"headers": headers,
	})
}

func (rs *FileResource) uploaded(c *gin.Context) {
	uid := userIdGet(c)
	alias := c.Param("alias")
	m, err := rs.fs.UploadDone(uid, alias)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, m)
}

func (rs *FileResource) find(c *gin.Context) {
	alias := c.Param("alias")
	link, err := rs.fs.PreSignGetURL(alias)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"link": link,
	})
}

func (rs *FileResource) rename(c *gin.Context) {
	p := new(bind.BodyFileRename)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := userIdGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Rename(uid, alias, p.NewName); err != nil {
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
	alias := c.Param("alias")
	if err := rs.fs.Move(uid, alias, p.NewDir); err != nil {
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

	uid := userIdGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Copy(uid, alias, p.NewPath); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) delete(c *gin.Context) {
	uid := userIdGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Delete(uid, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
