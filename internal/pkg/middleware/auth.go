package middleware

import (
	_ "embed"
	"fmt"
	"log"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/storyicon/grbac"
	"github.com/storyicon/grbac/pkg/meta"
	"gopkg.in/yaml.v3"

	"github.com/saltbo/zpan/internal/app/service"
	"github.com/saltbo/zpan/internal/pkg/authed"
)

//go:embed auth_rbac.yml
var embedRules []byte

func LoginAuth() gin.HandlerFunc {
	return LoginAuthWithRoles()
}

func LoginAuthWithRoles() gin.HandlerFunc {
	rules := make(meta.Rules, 0)
	if err := yaml.Unmarshal(embedRules, &rules); err != nil {
		log.Fatalln(err)
	}

	ctrl, err := grbac.New(grbac.WithRules(rules))
	if err != nil {
		log.Fatalln(err)
	}

	return func(c *gin.Context) {
		rc, err := token2Roles(c)
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
		authed.RoleSet(c, rc.Roles)
	}
}

func token2Roles(c *gin.Context) (*service.RoleClaims, error) {
	const basicPrefix = "Basic "
	const BearerPrefix = "Bearer "
	cookieAuth := authed.TokenCookieGet(c)
	headerAuth := c.GetHeader("Authorization")
	if (cookieAuth == "" && headerAuth == "") || strings.HasPrefix(headerAuth, basicPrefix) {
		return service.NewRoleClaims("anonymous", 3600, []string{"guest"}), nil
	}

	authToken := strings.TrimPrefix(headerAuth, BearerPrefix)
	if authToken == "" {
		authToken = cookieAuth
	}

	return service.NewToken().Verify(authToken)
}
