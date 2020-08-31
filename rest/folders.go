package rest

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type FolderResource struct {
}

func NewFolderResource() *FolderResource {
	return &FolderResource{}
}

func (rs *FolderResource) Register(router *gin.RouterGroup) {
	router.GET("/folders", rs.findAll)
	router.POST("/folders", rs.create)
	router.PATCH("/folders/:alias", rs.rename)
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
	if !service.MatterParentExist(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("parent dir not exist"))
		return
	}

	// matter exist
	if service.MatterExist(uid, p.Name, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("matter already exist"))
		return
	}

	if err := gormutil.DB().Create(p.ToMatter(uid)).Error; err != nil {
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

	file, err := service.UserFileGet(userIdGet(c), c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := service.FolderRename(file, p.NewName); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
