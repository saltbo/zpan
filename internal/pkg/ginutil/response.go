package ginutil

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/httputil"
)

// JSON writes a standard ok response with no data payload.
func JSON(c *gin.Context) {
	c.JSON(http.StatusOK, httputil.NewJSONResponse(nil))
}

// JSONError writes a standard error response and aborts the request.
func JSONError(c *gin.Context, status int, err error) {
	msg := "error"
	if err != nil {
		msg = err.Error()
	}

	c.AbortWithStatusJSON(status, httputil.JSONResponse{
		Code: status,
		Msg:  msg,
	})

	if err != nil {
		c.Error(err)
	}
}

// JSONData writes a standard ok response with a data payload.
func JSONData(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, httputil.NewJSONResponse(data))
}

// JSONList writes a standard ok response with list and total fields.
func JSONList(c *gin.Context, list interface{}, total int64) {
	c.JSON(http.StatusOK, httputil.NewJSONResponse(gin.H{
		"list":  list,
		"total": total,
	}))
}

// JSONBadRequest writes a 400 error response.
func JSONBadRequest(c *gin.Context, err error) {
	JSONError(c, http.StatusBadRequest, err)
}

// JSONUnauthorized writes a 401 error response.
func JSONUnauthorized(c *gin.Context, err error) {
	JSONError(c, http.StatusUnauthorized, err)
}

// JSONForbidden writes a 403 error response.
func JSONForbidden(c *gin.Context, err error) {
	JSONError(c, http.StatusForbidden, err)
}

// JSONServerError writes a 500 error response.
func JSONServerError(c *gin.Context, err error) {
	JSONError(c, http.StatusInternalServerError, err)
}

// Cookie sets a cookie with basic defaults.
func Cookie(c *gin.Context, name, value string, maxAge int) {
	c.SetCookie(name, value, maxAge, "/", "", false, false)
}

// FoundRedirect redirects with 302 and aborts.
func FoundRedirect(c *gin.Context, location string) {
	c.Redirect(http.StatusFound, location)
	c.Abort()
}

// MovedRedirect redirects with 301 and aborts.
func MovedRedirect(c *gin.Context, location string) {
	c.Redirect(http.StatusMovedPermanently, location)
	c.Abort()
}

// TemporaryRedirect redirects with 307 and aborts.
func TemporaryRedirect(c *gin.Context, location string) {
	c.Redirect(http.StatusTemporaryRedirect, location)
	c.Abort()
}
