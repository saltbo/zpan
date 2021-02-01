package middleware

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/storyicon/grbac"

	"github.com/saltbo/zpan/internal/app/service"
	"github.com/saltbo/zpan/internal/pkg/authed"
)

func LoginAuth() gin.HandlerFunc {
	return LoginAuthWithRoles()
}

func LoginAuthWithRoles() gin.HandlerFunc {
	ctrl, err := grbac.New(grbac.WithYAML("rbac.yml", time.Second))
	if err != nil {
		log.Fatalln(err)
	}

	return func(c *gin.Context) {
		rc, err := token2Roles(authed.TokenCookieGet(c))
		if err != nil {
			ginutil.JSONUnauthorized(c, err)
			return
		}

		state, err := ctrl.IsRequestGranted(c.Request, rc.Roles)
		if err != nil {
			ginutil.JSONServerError(c, err)
			return
		}

		if rc.Subject == "anonymous" && !state.IsGranted() {
			ginutil.JSONUnauthorized(c, fmt.Errorf("access deny, should login"))
			return
		}

		if !state.IsGranted() {
			ginutil.JSONForbidden(c, fmt.Errorf("access deny"))
			return
		}

		authed.UidSet(c, rc.Uid())
	}
}

func token2Roles(token string) (*service.RoleClaims, error) {
	if token == "" {
		return service.NewRoleClaims("anonymous", 3600, []string{"guest"}), nil
	}

	return service.NewToken().Verify(token)
}
