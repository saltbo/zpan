package authed

import (
	"github.com/gin-gonic/gin"

	"github.com/saltbo/zpan/internal/app/model"
)

const (
	ctxUidKey = "ctx-uid"

	cookieTokenKey = "z-token"
	cookieRoleKey  = "z-role"
)

func UidSet(c *gin.Context, uid int64) {
	c.Set(ctxUidKey, uid)
}

func UidGet(c *gin.Context) int64 {
	return c.GetInt64(ctxUidKey)
}

func RoleSet(c *gin.Context, roles []string) {
	c.Set("role", roles)
}

func IsAdmin(c *gin.Context) bool {
	for _, s := range c.GetStringSlice("role") {
		if s == model.RoleAdmin {
			return true
		}
	}

	return false
}

func TokenCookieSet(c *gin.Context, token string, expireSec int) {
	c.SetCookie(cookieTokenKey, token, expireSec, "/", "", false, true)
}

func TokenCookieGet(c *gin.Context) string {
	token, _ := c.Cookie(cookieTokenKey)
	return token
}

func RoleCookieSet(c *gin.Context, token string, expireSec int) {
	c.SetCookie(cookieRoleKey, token, expireSec, "/", "", false, false)
}

func roleCookieGet(c *gin.Context) (string, error) {
	return c.Cookie(cookieRoleKey)
}
