package api

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
	"github.com/saltbo/zpan/internal/pkg/fakefs"
)

type FileResource struct {
	fs *fakefs.FakeFS
}

func NewFileResource() ginutil.Resource {
	return &FileResource{
		fs: fakefs.New(),
	}
}

func (rs *FileResource) Register(router *gin.RouterGroup) {
	router.POST("/matters", rs.create)
	router.GET("/matters", rs.findAll)
	router.GET("/matters/:alias", rs.find)
	router.PATCH("/matters/:alias/uploaded", rs.uploaded)
	router.PATCH("/matters/:alias/name", rs.rename)
	router.PATCH("/matters/:alias/location", rs.move)
	router.PATCH("/matters/:alias/duplicate", rs.copy)
	router.DELETE("/matters/:alias", rs.delete)
}

func (rs *FileResource) findAll(c *gin.Context) {
	p := new(bind.QueryFiles)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, total, err := rs.fs.List(authed.UidGet(c), p)
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

	user, err := dao.NewUser().Find(authed.UidGet(c))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	} else if user.Storage.Overflowed(p.Size) {
		ginutil.JSONBadRequest(c, fmt.Errorf("service not enough space"))
		return
	}

	m := p.ToMatter(authed.UidGet(c))
	link, headers, err := rs.fs.PreSignPutURL(m)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"alias":   m.Alias,
		"object":  m.Object,
		"link":    link,
		"headers": headers,
	})
}

func (rs *FileResource) uploaded(c *gin.Context) {
	uid := authed.UidGet(c)
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
	link, err := rs.fs.BuildGetURL(alias)
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

	uid := authed.UidGet(c)
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

	uid := authed.UidGet(c)
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

	uid := authed.UidGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Copy(uid, alias, p.NewPath); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) delete(c *gin.Context) {
	uid := authed.UidGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Delete(uid, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
