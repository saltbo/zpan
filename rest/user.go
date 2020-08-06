package rest

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/dao"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
)

type UserResource struct {
}

func NewUserResource() ginutil.Resource {
	return &UserResource{}
}

func (rs *UserResource) Register(router *gin.RouterGroup) {
	router.GET("/users", rs.findAll)
	router.GET("/users/:uid", rs.find)
}

func (rs *UserResource) findAll(c *gin.Context) {
	p := new(bind.QueryUser)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list := make([]model.User, 0)
	total, err := dao.DB.Limit(p.Limit, p.Offset).FindAndCount(&list)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (rs *UserResource) find(c *gin.Context) {
	userId := c.Param("uid")

	user := new(model.User)
	if _, err := dao.DB.Id(userId).Get(user); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}
	user.Password = ""

	ginutil.JSONData(c, user)
}
