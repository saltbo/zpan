package rest

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/zpan/pkg/gormutil"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type FolderResource struct {
	folder *service.Folder
}

func NewFolderResource() ginutil.Resource {
	return &FolderResource{
		folder: service.NewFolder(),
	}
}

func (rs *FolderResource) Register(router *gin.RouterGroup) {
	router.GET("/folders", rs.findAll)
	router.POST("/folders", rs.create)
	router.PATCH("/folders/:alias/name", rs.rename)
	router.PATCH("/folders/:alias/dir", rs.move)
	router.DELETE("/folders/:alias", rs.delete)
}

func (rs *FolderResource) findAll(c *gin.Context) {
	p := new(bind.QueryFolder)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	var total int64
	list := make([]model.Matter, 0)
	query := "uid=? and dirtype=? and parent=?"
	sn := gormutil.DB().Where(query, userIdGet(c), model.DirTypeUser, p.Parent)
	sn.Model(model.Matter{}).Count(&total)
	if err := sn.Limit(p.Limit).Offset(p.Offset).Find(&list).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (rs *FolderResource) create(c *gin.Context) {
	p := new(bind.BodyFolder)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := userIdGet(c)
	if err := rs.folder.Create(p.ToMatter(uid)); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FolderResource) rename(c *gin.Context) {
	p := new(bind.BodyFileRename)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := userIdGet(c)
	alias := c.Param("alias")
	if err := rs.folder.Rename(uid, alias, p.NewName); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FolderResource) move(c *gin.Context) {
	p := new(bind.BodyFileMove)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := userIdGet(c)
	alias := c.Param("alias")
	if err := rs.folder.Move(uid, alias, p.NewDir); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FolderResource) delete(c *gin.Context) {
	uid := userIdGet(c)
	alias := c.Param("alias")
	if err := rs.folder.Remove(uid, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
