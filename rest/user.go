package rest

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	mc "github.com/saltbo/moreu/client"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type UserResource struct {
	user *service.User
}

func NewUserResource(iss uint64) *UserResource {
	return &UserResource{
		user: service.NewUser(iss),
	}
}

func (rs *UserResource) Register(router *gin.RouterGroup) {
	router.GET("/users", rs.findAll)
	//router.GET("/users/:id", rs.find)
	router.PATCH("/users/:id/storage", rs.storageUpdate)
	router.GET("/users/me", rs.me)
}

func (rs *UserResource) findAll(c *gin.Context) {
	p := new(bind.QueryStorage)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, total, err := rs.user.FindAll(c.GetHeader("Cookie"), p.Email, p.Offset, p.Limit)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (rs *UserResource) me(c *gin.Context) {
	user, err := rs.user.Find(mc.GetUx(c))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, user)
}

func (rs *UserResource) storageUpdate(c *gin.Context) {
	p := new(bind.BodyStorageQuota)
	if err := c.Bind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := rs.user.StoragePatch(id, p.Max); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *UserResource) Injector() gin.HandlerFunc {
	return func(c *gin.Context) {
		u, err := rs.user.Find(mc.GetUx(c))
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
