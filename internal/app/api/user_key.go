package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/app/service"
	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

type UserKeyResource struct {
	dUserKey *dao.UserKey
	sUserKey *service.UserKey
}

func NewUserKeyResource() *UserKeyResource {
	return &UserKeyResource{
		dUserKey: dao.NewUserKey(),
		sUserKey: service.NewUserKey(),
	}
}

func (rs *UserKeyResource) Register(router *gin.RouterGroup) {
	router.POST("/user/keys", rs.create)              // 创建一个KEY
	router.GET("/user/keys/:name", rs.find)           // 获取一个KEY
	router.PATCH("/user/keys/:name/secret", rs.reset) // 重置KEY的secret
	router.DELETE("/user/keys/:name", rs.remove)      // 重置KEY的secret
}

// create godoc
// @Tags UserKeys
// @Summary 创建秘钥
// @Description 创建秘钥
// @Accept json
// @Produce json
// @Param body body bind.BodyUserKeyCreation true "参数"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /user/keys [post]
func (rs *UserKeyResource) create(c *gin.Context) {
	p := new(bind.BodyUserKeyCreation)
	if err := c.ShouldBind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uk := model.NewUserKey(authed.UidGet(c), p.Name)
	if err := rs.sUserKey.Create(uk); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, uk)
}

// find godoc
// @Tags UserKeys
// @Summary 查询秘钥
// @Description 查询秘钥
// @Accept json
// @Produce json
// @Param name path string true "秘钥名称"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /user/keys/{name} [get]
func (rs *UserKeyResource) find(c *gin.Context) {
	uk, err := rs.dUserKey.Find(authed.UidGet(c), c.Param("name"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	ginutil.JSONData(c, uk)
}

// reset godoc
// @Tags UserKeys
// @Summary 重置秘钥
// @Description 重置秘钥
// @Accept json
// @Produce json
// @Param name path string true "秘钥名称"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /user/keys/{name}/secret [patch]
func (rs *UserKeyResource) reset(c *gin.Context) {
	uk, err := rs.dUserKey.Find(authed.UidGet(c), c.Param("name"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.sUserKey.ResetSecret(uk); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, uk)
}

// remove godoc
// @Tags UserKeys
// @Summary 删除秘钥
// @Description 删除秘钥
// @Accept json
// @Produce json
// @Param name path string true "秘钥名称"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /user/keys/{name} [delete]
func (rs *UserKeyResource) remove(c *gin.Context) {
	uk, err := rs.dUserKey.Find(authed.UidGet(c), c.Param("name"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.dUserKey.Delete(uk); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
