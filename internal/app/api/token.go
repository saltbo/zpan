package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	_ "github.com/saltbo/gopkg/httputil"

	"github.com/saltbo/zpan/internal/app/service"
	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

type TokenResource struct {
	sUser *service.User
}

func NewTokenResource() *TokenResource {
	return &TokenResource{
		sUser: service.NewUser(),
	}
}

func (rs *TokenResource) Register(router *gin.RouterGroup) {
	router.POST("/tokens", rs.create)
	router.DELETE("/tokens", rs.delete)
}

// create godoc
// @Tags v1/Tokens
// @Summary 登录/密码重置
// @Description 用于账户登录和申请密码重置
// @Accept json
// @Produce json
// @Param body body bind.BodyToken true "参数"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/tokens [post]
func (rs *TokenResource) create(c *gin.Context) {
	p := new(bind.BodyToken)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	// issue a recover token to the user mail
	if p.Password == "" {
		if err := rs.sUser.PasswordResetApply(ginutil.GetOrigin(c), p.Email); err != nil {
			ginutil.JSONServerError(c, err)
			return
		}

		ginutil.JSON(c)
	}

	// issue a signIn token into cookies
	expireSec := 7 * 24 * 3600
	user, err := rs.sUser.SignIn(p.Email, p.Password, expireSec)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	authed.TokenCookieSet(c, user.Token, expireSec)
	authed.RoleCookieSet(c, user.Roles, expireSec)
	ginutil.JSON(c)
}

// delete godoc
// @Tags v1/Tokens
// @Summary 退出登录
// @Description 用户状态登出
// @Accept json
// @Produce json
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/tokens [delete]
func (rs *TokenResource) delete(c *gin.Context) {
	authed.TokenCookieSet(c, "", 1)
	authed.RoleCookieSet(c, "", 1)
	return
}
