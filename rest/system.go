package rest

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/jwtutil"

	"github.com/saltbo/zpan/dao"
	"github.com/saltbo/zpan/provider"
)

type Option struct {
	jwtutil.JWTUtil
}

func NewOptionResource() *Option {
	return &Option{}
}

func (rs *Option) Register(router *gin.RouterGroup) {
	router.GET("/system/providers", rs.providers)
	router.GET("/system/options/:name", rs.find)
	router.PUT("/system/options/:name", rs.update)
}

func (rs *Option) providers(c *gin.Context) {
	ginutil.JSONData(c, provider.GetProviders())
}

func (rs *Option) find(c *gin.Context) {
	ret, err := dao.NewOption().Get(c.Param("name"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	ginutil.JSONData(c, ret)
}

func (rs *Option) update(c *gin.Context) {
	p := make(map[string]interface{})
	if err := c.ShouldBind(&p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := dao.NewOption().Save(c.Param("name"), p); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
