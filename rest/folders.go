package rest

import (
	"fmt"
	"github.com/saltbo/zpan/disk"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type FolderResource struct {
	provider disk.Provider
}

func NewFolderResource(conf disk.Config) ginutil.Resource {
	//return &FolderResource{}
	provider, err := disk.New(conf)
	if err != nil {
		log.Fatalln(err)
	}

	return &FolderResource{
		provider: provider,
	}
}

func (rs *FolderResource) Register(router *gin.RouterGroup) {
	router.GET("/folders", rs.findAll)
	router.POST("/folders", rs.create)
	router.PATCH("/folders/:alias", rs.rename)
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
	if !service.MatterParentExist(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("parent dir not exist"))
		return
	}

	// check current dir file quota
	if service.MatterOverflowed(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("dir file quota is not enough"))
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

func(rs *FolderResource) DelDir(src *model.Matter, c *gin.Context) error {
	// if not directory return
	if !src.IsDir() {
		return fmt.Errorf("the file is not directory")
	}
	// traverse the directory
	var files []model.Matter
	if err := gormutil.DB().Where("parent=?", src.Name+"/").Find(&files).Error; err != nil {
		return err
	}

	var objectString []string
	for _, v := range files {
		if v.IsDir() {
			rs.DelDir(&v, c)
		} else {
			objectString = append(objectString, v.Object)
		}
	}
	// if the dir is empty return
	if len(objectString) > 0 {
		if err := rs.provider.ObjectsDelete(objectString); err != nil {
			return err
		}
	}
	gormutil.DB().Delete(model.Matter{}, "parent=? or name=?", src.Name+"/", src.Name)

	return nil
}

func (rs *FolderResource) delete(c *gin.Context) {
	user := userGet(c)

	file, err := service.UserFileGet(user.Id, c.Param("alias"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.DelDir(file, c); err != nil {
		ginutil.JSONServerError(c, err)
	}
	ginutil.JSON(c)
}
