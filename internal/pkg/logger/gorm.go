package logger

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"gorm.io/gorm/logger"
)

// GormSlogger 是 GORM 的 slog 适配器
type GormSlogger struct {
	logger *slog.Logger
	level  logger.LogLevel
}

// NewGormSlogger 创建新的 GORM slog logger
func NewGormSlogger() logger.Interface {
	return &GormSlogger{
		logger: defaultLogger,
		level:  convertSlogLevelToGormLevel(logLevel),
	}
}

// LogMode 设置日志级别
func (l *GormSlogger) LogMode(level logger.LogLevel) logger.Interface {
	l.level = level
	return l
}

// Info 记录信息日志
func (l *GormSlogger) Info(ctx context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Info {
		l.logger.InfoContext(ctx, fmt.Sprintf(msg, data...))
	}
}

// Warn 记录警告日志
func (l *GormSlogger) Warn(ctx context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Warn {
		l.logger.WarnContext(ctx, fmt.Sprintf(msg, data...))
	}
}

// Error 记录错误日志
func (l *GormSlogger) Error(ctx context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Error {
		l.logger.ErrorContext(ctx, fmt.Sprintf(msg, data...))
	}
}

// Trace 记录 SQL 日志
func (l *GormSlogger) Trace(ctx context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	if l.level <= logger.Silent {
		return
	}

	elapsed := time.Since(begin)
	sql, rowsAffected := fc()

	switch {
	case err != nil && l.level >= logger.Error:
		l.logger.ErrorContext(ctx, "SQL error",
			"sql", sql,
			"rows_affected", rowsAffected,
			"elapsed", elapsed,
			"error", err,
		)
	case elapsed > 0 && l.level >= logger.Warn:
		l.logger.WarnContext(ctx, "SQL executed",
			"sql", sql,
			"rows_affected", rowsAffected,
			"elapsed", elapsed,
		)
	case l.level >= logger.Info:
		l.logger.InfoContext(ctx, "SQL executed",
			"sql", sql,
			"rows_affected", rowsAffected,
			"elapsed", elapsed,
		)
	}
}

// convertSlogLevelToGormLevel 将 slog.Level 转换为 GORM logger.LogLevel
func convertSlogLevelToGormLevel(level slog.Level) logger.LogLevel {
	switch level {
	case slog.LevelDebug:
		return logger.Info
	case slog.LevelInfo:
		return logger.Warn
	case slog.LevelWarn:
		return logger.Error
	case slog.LevelError:
		return logger.Silent
	default:
		return logger.Warn
	}
}
