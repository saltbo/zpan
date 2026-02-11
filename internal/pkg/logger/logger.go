package logger

import (
	"log/slog"
	"os"
	"strings"
)

var (
	defaultLogger *slog.Logger
	logLevel      slog.Level = slog.LevelInfo // 默认日志级别为 info
)

// Init 初始化日志系统，应在程序启动时调用
func Init(levelStr string) {
	level := ParseLogLevel(levelStr)
	logLevel = level
	opts := &slog.HandlerOptions{
		Level: logLevel,
	}
	handler := slog.NewTextHandler(os.Stdout, opts)
	defaultLogger = slog.New(handler)
	slog.SetDefault(defaultLogger)
}

// ParseLogLevel 将字符串解析为 slog.Level
func ParseLogLevel(levelStr string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(levelStr)) {
	case "debug":
		return slog.LevelDebug
	case "info":
		return slog.LevelInfo
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// Debug 记录 debug 级别日志
func Debug(msg string, args ...any) {
	defaultLogger.Debug(msg, args...)
}

// Info 记录 info 级别日志
func Info(msg string, args ...any) {
	defaultLogger.Info(msg, args...)
}

// Warn 记录 warn 级别日志
func Warn(msg string, args ...any) {
	defaultLogger.Warn(msg, args...)
}

// Error 记录 error 级别日志
func Error(msg string, args ...any) {
	defaultLogger.Error(msg, args...)
}

// Fatal 记录 fatal 级别日志并退出程序
func Fatal(msg string, args ...any) {
	defaultLogger.Error(msg, args...)
	os.Exit(1)
}

// DebugContext 记录 debug 级别日志 (带上下文)
func DebugContext(ctx any, msg string, args ...any) {
	allArgs := append([]any{"ctx", ctx}, args...)
	defaultLogger.Debug(msg, allArgs...)
}

// InfoContext 记录 info 级别日志 (带上下文)
func InfoContext(ctx any, msg string, args ...any) {
	allArgs := append([]any{"ctx", ctx}, args...)
	defaultLogger.Info(msg, allArgs...)
}

// WarnContext 记录 warn 级别日志 (带上下文)
func WarnContext(ctx any, msg string, args ...any) {
	allArgs := append([]any{"ctx", ctx}, args...)
	defaultLogger.Warn(msg, allArgs...)
}

// ErrorContext 记录 error 级别日志 (带上下文)
func ErrorContext(ctx any, msg string, args ...any) {
	allArgs := append([]any{"ctx", ctx}, args...)
	defaultLogger.Error(msg, allArgs...)
}

// GetLogger 获取默认的 slog.Logger
func GetLogger() *slog.Logger {
	return defaultLogger
}

// GetLogLevel 获取当前的日志级别
func GetLogLevel() slog.Level {
	return logLevel
}
