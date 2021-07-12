package api

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/go-oauth2/oauth2/v4/errors"
	"github.com/go-oauth2/oauth2/v4/manage"
	"github.com/go-oauth2/oauth2/v4/server"
	"github.com/go-oauth2/oauth2/v4/store"
	"github.com/saltbo/gopkg/ginutil"
	_ "github.com/saltbo/gopkg/httputil"

	"github.com/saltbo/zpan/internal/app/service"
	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

type TokenResource struct {
	sUser *service.User

	srv *server.Server
}

func NewTokenResource() *TokenResource {
	uk := service.NewUserKey()
	uk.LoadExistClient()
	manager := manage.NewManager()
	manager.MapAccessGenerate(uk)
	manager.MapClientStorage(uk.ClientStore())
	manager.MustTokenStorage(store.NewMemoryTokenStore())

	srv := server.NewDefaultServer(manager)
	srv.SetAllowGetAccessRequest(true)
	srv.SetClientInfoHandler(server.ClientBasicHandler)
	srv.SetInternalErrorHandler(func(err error) (re *errors.Response) {
		log.Println("Internal Error:", err.Error())
		return
	})

	return &TokenResource{
		srv:   srv,
		sUser: service.NewUser(),
	}
}

func (rs *TokenResource) Register(router *gin.RouterGroup) {
	router.POST("/tokens", rs.create)
	router.DELETE("/tokens", rs.delete)
}

// create godoc
// @Tags Tokens
// @Summary 登录/密码重置
// @Description 用于账户登录和申请密码重置
// @Accept json
// @Produce json
// @Param body body bind.BodyToken true "参数"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /tokens [post]
func (rs *TokenResource) create(c *gin.Context) {
	// support gen oauth2 access_token
	if _, _, ok := c.Request.BasicAuth(); ok {
		rs.srv.HandleTokenRequest(c.Writer, c.Request)
		return
	}

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
// @Tags Tokens
// @Summary 退出登录
// @Description 用户状态登出
// @Accept json
// @Produce json
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /tokens [delete]
func (rs *TokenResource) delete(c *gin.Context) {
	authed.TokenCookieSet(c, "", 1)
	authed.RoleCookieSet(c, "", 1)
	return
}
