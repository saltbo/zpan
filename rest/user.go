package rest

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	mc "github.com/saltbo/moreu/client"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/service"
)

type UserResource struct {
}

func NewUserResource() *UserResource {
	return &UserResource{}
}

func (rs *UserResource) Register(router *gin.RouterGroup) {
	router.GET("/users/me", rs.me)
}

func (rs *UserResource) me(c *gin.Context) {
	user, err := service.UserFind(mc.GetUx(c))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, user)
}

func UserInjector() gin.HandlerFunc {
	return func(c *gin.Context) {
		u, err := service.UserFind(mc.GetUx(c))
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}

		c.Set("user", u)
		c.Set("uid", u.Id)
	}
}

func userGet(c *gin.Context) (u *model.User) {
	if val, ok := c.Get("user"); ok && val != nil {
		u, _ = val.(*model.User)
	}
	return
}

func userIdGet(c *gin.Context) int64 {
	return c.GetInt64("uid")
}
