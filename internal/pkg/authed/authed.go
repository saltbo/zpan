package authed

import "github.com/gin-gonic/gin"

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
