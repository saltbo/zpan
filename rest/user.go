package rest

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type UserResource struct {
	user *service.User
}

func NewUserResource() *UserResource {
	return &UserResource{
		user: service.NewUser(),
	}
}

func (rs *UserResource) Register(router *gin.RouterGroup) {
	router.GET("/users", rs.findAll)

	router.PATCH("/users/:id/storage", rs.storageUpdate)
	router.GET("/user/storage", rs.myStorage)
}

func (rs *UserResource) findAll(c *gin.Context) {
	p := new(bind.QueryUser)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, err := rs.user.FindAll(p.Uxs...)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, int64(len(list)))
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

func (rs *UserResource) myStorage(c *gin.Context) {
	userStorage, err := rs.user.Find(userIdGet(c))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, userStorage)
}
