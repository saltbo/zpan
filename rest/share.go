package rest

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/randutil"

	"github.com/saltbo/zpan/dao"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
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
	secret := c.Query("secret")

	share := new(model.Share)
	if exist, err := dao.DB.Where("alias=?", c.Param("alias")).Get(share); err != nil {
		ginutil.JSONServerError(c, err)
		return
	} else if !exist {
		ginutil.JSONBadRequest(c, fmt.Errorf("share not found"))
		return
	} else if secret == "" && share.Secret != "" {
		ginutil.JSONData(c, gin.H{"k": "please submit secret."})
		return
	} else if share.Secret != secret {
		ginutil.JSONBadRequest(c, fmt.Errorf("invalid secret"))
		return
	} else if time.Now().After(share.ExpireAt) {
		ginutil.JSONBadRequest(c, fmt.Errorf("share expired"))
		return
	}

	matter := new(model.Matter)
	if exist, err := dao.DB.Id(share.MatterId).Get(matter); err != nil {
		ginutil.JSONServerError(c, err)
		return
	} else if !exist {
		ginutil.JSONBadRequest(c, fmt.Errorf("matter not exist"))
		return
	}

	ginutil.JSONData(c, matter)
}

func (rs *ShareResource) findAll(c *gin.Context) {
	p := new(bind.QueryPage)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list := make([]model.Share, 0)
	sn := dao.DB.Limit(p.Limit, p.Offset)
	total, err := sn.FindAndCount(&list)
	if err != nil {
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
	if exist, err := dao.DB.Id(p.MId).Get(matter); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	} else if !exist {
		ginutil.JSONBadRequest(c, fmt.Errorf("matter not found"))
		return
	}

	m := model.Share{
		Alias:    randutil.RandString(12),
		Uid:      c.GetInt64("uid"),
		MatterId: matter.Id,
		Name:     matter.Name,
		ExpireAt: time.Now().Add(time.Second * time.Duration(p.ExpireSec)),
	}
	if p.Private {
		m.Secret = randutil.RandString(5)
	}
	if _, err := dao.DB.Insert(m); err != nil {
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
	if exist, err := dao.DB.Id(p.Id).Get(share); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	} else if !exist {
		ginutil.JSONBadRequest(c, fmt.Errorf("share not found"))
		return
	}

	if p.Private && share.Secret == "" {
		share.Secret = randutil.RandString(5)
	}

	if _, err := dao.DB.Id(share.Id).Update(share); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *ShareResource) delete(c *gin.Context) {
	alias := c.Param("alias")

	share := new(model.Share)
	if exist, err := dao.DB.Where("alias=?", alias).Get(share); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	} else if !exist {
		ginutil.JSONBadRequest(c, fmt.Errorf("matter not found"))
	}

	if _, err := dao.DB.Id(share.Id).Delete(share); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
