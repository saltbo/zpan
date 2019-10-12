package api

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/gin-gonic/gin"

	"zpan/dao"
	"zpan/model"
	"zpan/pkg/ginx"
)

type ShareResource struct {
}

func NewShareResource() Resource {
	return &ShareResource{}
}

func (rs *ShareResource) Register(router *ginx.Router) {
	router.GET("/shares/:alias", rs.find)
	router.GET("/shares", rs.findAll)
	router.POST("/shares", rs.create)
	router.PATCH("/shares/:alias", rs.update)
	router.DELETE("/shares/:alias", rs.delete)
}

func (rs *ShareResource) find(c *gin.Context) error {
	secret := c.Query("secret")

	share := new(model.Share)
	if exist, err := dao.DB.Where("alias=?", c.Param("alias")).Get(share); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("share not found."))
	} else if secret == "" && share.Secret != "" {
		return ginx.Json(c, map[string]string{"k": "please submit secret."})
	} else if share.Secret != secret {
		return ginx.Error(fmt.Errorf("invalid secret."))
	} else if time.Now().After(share.ExpireAt) {
		return ginx.Error(fmt.Errorf("share expired."))
	}

	matter := new(model.Matter)
	if exist, err := dao.DB.Id(share.MatterId).Get(matter); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("matter not exist."))
	}

	return ginx.Json(c, matter)
}

func (rs *ShareResource) findAll(c *gin.Context) error {
	p := new(QueryPage)
	if err := c.BindQuery(p); err != nil {
		return ginx.Error(err)
	}

	list := make([]model.Share, 0)
	sn := dao.DB.Limit(p.Limit, p.Offset)
	total, err := sn.FindAndCount(&list)
	if err != nil {
		return ginx.Error(err)
	}

	return ginx.JsonList(c, list, total)
}

func (rs *ShareResource) create(c *gin.Context) error {
	p := new(BodyShare)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	matter := new(model.Matter)
	if exist, err := dao.DB.Id(p.MId).Get(matter); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("matter not found."))
	}

	m := model.Share{
		Alias:    randomString(12),
		Uid:      c.GetInt64("uid"),
		MatterId: matter.Id,
		Name:     matter.Name,
		ExpireAt: time.Now().Add(time.Second * time.Duration(p.ExpireSec)),
	}
	if p.Private {
		m.Secret = randomString(5)
	}
	if _, err := dao.DB.Insert(m); err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, m)
}

func (rs *ShareResource) update(c *gin.Context) error {
	p := new(BodyShare)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	share := new(model.Share)
	if exist, err := dao.DB.Id(p.Id).Get(share); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("share not found."))
	}

	if p.Private && share.Secret == "" {
		share.Secret = randomString(5)
	}

	if _, err := dao.DB.Id(share.Id).Update(share); err != nil {
		return ginx.Failed(err)
	}

	return nil
}

func (rs *ShareResource) delete(c *gin.Context) error {
	alias := c.Param("alias")

	share := new(model.Share)
	if exist, err := dao.DB.Where("alias=?", alias).Get(share); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("matter not found."))
	}

	if _, err := dao.DB.Id(share.Id).Delete(share); err != nil {
		return ginx.Failed(err)
	}

	return nil
}

func randomString(length int) (ret string) {
	chars := "abcdefghijklmnopqrstuvwxyz0123456789"
	for i := 0; i < length; i++ {
		offset := rand.Intn(len(chars) - 1)
		ret += chars[offset : offset+1]
	}
	return
}
