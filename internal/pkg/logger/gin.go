package logger

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

// GinSlogMiddleware 创建一个 Gin 中间件，使用 slog 记录日志
func GinSlogMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		duration := time.Since(start)
		statusCode := c.Writer.Status()
		dataLength := c.Writer.Size()
		clientIP := c.ClientIP()
		method := c.Request.Method

		// 根据状态码决定日志级别
		var level slog.Level
		if statusCode >= 500 {
			level = slog.LevelError
		} else if statusCode >= 400 {
			level = slog.LevelWarn
		} else {
			level = slog.LevelInfo
		}

		// 获取错误消息
		var errorMsg string
		if len(c.Errors) > 0 {
			for i, err := range c.Errors {
				if i > 0 {
					errorMsg += "; "
				}
				errorMsg += err.Error()
			}
		}

		if logLevel <= level {
			args := []any{
				"method", method,
				"path", path,
				"status", statusCode,
				"duration", fmt.Sprintf("%.3fms", float64(duration.Microseconds())/1000.0),
				"client_ip", clientIP,
				"data_length", dataLength,
			}

			if query != "" {
				args = append(args, "query", query)
			}

			if errorMsg != "" {
				args = append(args, "error", errorMsg)
			}

			log := defaultLogger.With(args...)
			switch level {
			case slog.LevelError:
				log.Error("HTTP request failed")
			case slog.LevelWarn:
				log.Warn("HTTP client error")
			default:
				log.Info("HTTP request processed")
			}
		}
	}
}
