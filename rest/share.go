package rest

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/gopkg/randutil"
	moreu "github.com/saltbo/moreu/client"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type ShareResource struct {
}

func NewShareResource() ginutil.Resource {
	return &ShareResource{}
}

func (rs *ShareResource) Register(router *gin.RouterGroup) {
	router.GET("/shares/:alias", rs.find)
	router.GET("/shares", rs.findAll)
	router.POST("/shares", rs.create)
	router.PATCH("/shares/:alias", rs.update)
	router.DELETE("/shares/:alias", rs.delete)
}

func (rs *ShareResource) find(c *gin.Context) {
	p := new(bind.QueryShare)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	share := new(model.Share)
	if gormutil.DB().First(share, "alias=?", c.Param("alias")).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("share not found"))
		return
	} else if p.Secret == "" && share.Secret != "" {
		ginutil.JSONForbidden(c, fmt.Errorf("please submit secret"))
		return
	} else if share.Secret != p.Secret {
		ginutil.JSONForbidden(c, fmt.Errorf("invalid secret"))
		return
	} else if time.Now().After(share.ExpireAt) {
		ginutil.JSONForbidden(c, fmt.Errorf("share expired"))
		return
	}

	matter := new(model.Matter)
	if gormutil.DB().First(matter, "alias=?", share.Matter).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("matter not exist"))
		return
	}

	sm := service.NewMatter(share.Uid)
	if matter.IsDir() {
		sm.SetDir(fmt.Sprintf("%s/%s", matter.Name, p.Dir)) // 设置父级目录
		list, total, err := sm.Find(p.Offset, p.Limit)
		if err != nil {
			ginutil.JSONServerError(c, err)
			return
		}
		ginutil.JSONData(c, gin.H{
			"matter": matter,
			"list":   list,
			"total":  total,
		})
		return
	}

	ginutil.JSONData(c, gin.H{
		"matter": matter,
	})
}

func (rs *ShareResource) findAll(c *gin.Context) {
	p := new(bind.QueryPage)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	var total int64
	list := make([]model.Share, 0)
	sn := gormutil.DB().Where("uid=?", moreu.GetUserId(c))
	sn.Model(model.Share{}).Count(&total)
	if err := sn.Limit(p.Limit).Offset(p.Offset).Find(&list).Error; err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (rs *ShareResource) create(c *gin.Context) {
	p := new(bind.BodyShare)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	matter := new(model.Matter)
	if gormutil.DB().First(matter, "alias=?", p.Matter).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("matter not found"))
		return
	}

	m := &model.Share{
		Alias:    randutil.RandString(12),
		Uid:      moreu.GetUserId(c),
		Name:     matter.Name,
		Matter:   matter.Alias,
		ExpireAt: time.Now().Add(time.Second * time.Duration(p.ExpireSec)),
	}
	if p.Private {
		m.Secret = randutil.RandString(5)
	}
	if err := gormutil.DB().Create(m).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, m)
}

func (rs *ShareResource) update(c *gin.Context) {
	p := new(bind.BodyShare)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	share := new(model.Share)
	if gormutil.DB().First(share, "id=?", p.Id).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("share not found"))
		return
	}

	if p.Private && share.Secret == "" {
		share.Secret = randutil.RandString(5)
	}

	if err := gormutil.DB().Update(share).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *ShareResource) delete(c *gin.Context) {
	alias := c.Param("alias")

	share := new(model.Share)
	if gormutil.DB().First(share, "alias=?", alias).RecordNotFound() {
		ginutil.JSONBadRequest(c, fmt.Errorf("share not exist"))
		return
	}

	if err := gormutil.DB().Delete(share, "id=?", share.Id).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
