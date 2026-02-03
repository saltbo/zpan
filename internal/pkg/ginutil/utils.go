package ginutil

import (
	"fmt"

	"github.com/gin-gonic/gin"
)

// GetOrigin returns the request origin, respecting forwarded headers.
func GetOrigin(c *gin.Context) string {
	scheme := "http"
	host := c.Request.Host
	if forwardedHost := c.GetHeader("X-Forwarded-Host"); forwardedHost != "" {
		host = forwardedHost
	}
	if forwardedProto := c.GetHeader("X-Forwarded-Proto"); forwardedProto == "https" {
		scheme = forwardedProto
	}

	return fmt.Sprintf("%s://%s", scheme, host)
}
