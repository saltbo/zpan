package ginutil

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

// ParamInt returns the int value of a path param. On error, returns 0.
func ParamInt(c *gin.Context, name string) int {
	v, _ := strconv.Atoi(c.Param(name))
	return v
}

// ParamInt64 returns the int64 value of a path param. On error, returns 0.
func ParamInt64(c *gin.Context, name string) int64 {
	v, _ := strconv.ParseInt(c.Param(name), 10, 64)
	return v
}

// QueryInt returns the int value of a query param. On error, returns 0.
func QueryInt(c *gin.Context, name string) int {
	v, _ := strconv.Atoi(c.Query(name))
	return v
}

// QueryInt64 returns the int64 value of a query param. On error, returns 0.
func QueryInt64(c *gin.Context, name string) int64 {
	v, _ := strconv.ParseInt(c.Query(name), 10, 64)
	return v
}
