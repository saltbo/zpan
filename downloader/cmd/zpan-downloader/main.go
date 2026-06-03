package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
	"github.com/saltbo/zpan/downloader/internal/config"
	"github.com/saltbo/zpan/downloader/internal/worker"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	if err := rootCommand().Execute(); err != nil {
		slog.Error("command failed", "error", err)
		os.Exit(1)
	}
}

func rootCommand() *cobra.Command {
	v := viper.New()
	var cfgFile string
	var logLevel string

	root := &cobra.Command{
		Use:   "zpan-downloader",
		Short: "Remote downloader for ZPan",
	}
	root.PersistentFlags().StringVar(&cfgFile, "config", config.DefaultConfigPath(), "config file")
	root.PersistentFlags().StringVar(&logLevel, "log-level", "info", "log level: debug, info, warn, error")
	root.PersistentPreRun = func(cmd *cobra.Command, args []string) {
		setLogLevel(logLevel)
		v.SetConfigFile(cfgFile)
	}

	root.AddCommand(runCommand(v))
	root.AddCommand(loginCommand(v, &cfgFile))
	root.AddCommand(configCommand(v, &cfgFile))
	return root
}

func setLogLevel(level string) {
	var parsed slog.Level
	switch strings.ToLower(level) {
	case "debug":
		parsed = slog.LevelDebug
	case "info", "":
		parsed = slog.LevelInfo
	case "warn", "warning":
		parsed = slog.LevelWarn
	case "error":
		parsed = slog.LevelError
	default:
		slog.Warn("unknown log level, using info", "log_level", level)
		parsed = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: parsed})))
}

func runCommand(v *viper.Viper) *cobra.Command {
	return &cobra.Command{
		Use:   "run",
		Short: "Start the downloader worker",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("loading downloader config")
			cfg, err := config.Load(v)
			if err != nil {
				return err
			}
			slog.Info("downloader config loaded",
				"server_url", cfg.ServerURL,
				"engine", cfg.Engine,
				"download_dir", cfg.DownloadDir,
				"poll_interval", cfg.PollInterval.String(),
				"max_concurrent_tasks", cfg.MaxConcurrentTasks,
				"seed_enabled", cfg.SeedEnabled,
				"seed_duration", cfg.SeedDuration.String(),
				"seed_cache_limit", cfg.SeedCacheLimit,
			)
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			return worker.New(cfg).Run(ctx)
		},
	}
}

func loginCommand(v *viper.Viper, cfgFile *string) *cobra.Command {
	var name string
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Register this downloader with ZPan using device login",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("starting downloader device login")
			config.Defaults(v)
			v.SetConfigFile(*cfgFile)
			if err := v.ReadInConfig(); err != nil {
				var notFound viper.ConfigFileNotFoundError
				if !errors.As(err, &notFound) && !errors.Is(err, os.ErrNotExist) {
					return err
				}
			}
			serverURL := strings.TrimRight(v.GetString("server_url"), "/")
			if serverURL == "" {
				return fmt.Errorf("server_url is required")
			}
			slog.Info("requesting device login code", "server_url", serverURL)
			if name == "" {
				hostname, _ := os.Hostname()
				name = hostname
				if name == "" {
					name = "zpan-downloader"
				}
			}

			api := client.New(serverURL, "")
			ctx := cmd.Context()
			code, err := api.RequestDeviceCode(ctx)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Open this URL to authorize the downloader:\n%s\n\n", code.VerificationURIComplete)
			fmt.Fprintf(cmd.OutOrStdout(), "User code: %s\n", code.UserCode)

			slog.Info("waiting for device authorization", "user_code", code.UserCode)
			token, err := pollDeviceToken(ctx, api, code)
			if err != nil {
				return err
			}
			slog.Info("device authorization completed")
			heartbeat, err := loginHeartbeat(v)
			if err != nil {
				return err
			}
			registered, err := api.CreateDownloader(ctx, token.AccessToken, client.CreateDownloaderRequest{
				Name:      name,
				Heartbeat: heartbeat,
			})
			if err != nil {
				return err
			}
			slog.Info("downloader registered", "downloader_id", registered.Downloader.ID)

			v.Set("server_url", serverURL)
			v.Set("token", registered.Token)
			if err := os.MkdirAll(filepath.Dir(*cfgFile), 0o755); err != nil {
				return err
			}
			if _, err := os.Stat(*cfgFile); err == nil {
				if err := v.WriteConfigAs(*cfgFile); err != nil {
					return err
				}
			} else {
				if err := v.SafeWriteConfigAs(*cfgFile); err != nil {
					return err
				}
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Downloader registered: %s\n", registered.Downloader.ID)
			fmt.Fprintf(cmd.OutOrStdout(), "Config saved: %s\n", *cfgFile)
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "downloader name")
	return cmd
}

func configCommand(v *viper.Viper, cfgFile *string) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage downloader configuration",
	}
	cmd.AddCommand(&cobra.Command{
		Use:   "init",
		Short: "Create a default config file",
		RunE: func(cmd *cobra.Command, args []string) error {
			config.Defaults(v)
			v.SetConfigFile(*cfgFile)
			if err := os.MkdirAll(filepath.Dir(*cfgFile), 0o755); err != nil {
				return err
			}
			return v.SafeWriteConfigAs(*cfgFile)
		},
	})
	return cmd
}

func pollDeviceToken(ctx context.Context, api *client.Client, code client.DeviceCode) (client.DeviceToken, error) {
	interval := time.Duration(code.Interval) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	deadline := time.Now().Add(time.Duration(code.ExpiresIn) * time.Second)
	for {
		if time.Now().After(deadline) {
			return client.DeviceToken{}, fmt.Errorf("device login expired")
		}
		select {
		case <-ctx.Done():
			return client.DeviceToken{}, ctx.Err()
		case <-time.After(interval):
		}
		token, err := api.PollDeviceToken(ctx, code.DeviceCode)
		if err == nil {
			return token, nil
		}
		if !isPendingDeviceAuthError(err) {
			return client.DeviceToken{}, err
		}
	}
}

func isPendingDeviceAuthError(err error) bool {
	message := err.Error()
	return strings.Contains(message, "authorization_pending") || strings.Contains(message, "slow_down")
}

func loginHeartbeat(v *viper.Viper) (client.Heartbeat, error) {
	hostname, _ := os.Hostname()
	engine, err := normalizeLoginEngine(v.GetString("engine"))
	if err != nil {
		return client.Heartbeat{}, err
	}
	return client.Heartbeat{
		Version:            worker.Version,
		Hostname:           hostname,
		Platform:           runtime.GOOS,
		Arch:               runtime.GOARCH,
		Engine:             engine,
		Capabilities:       loginCapabilities(engine),
		MaxConcurrentTasks: v.GetInt("max_concurrent_tasks"),
		CurrentTasks:       0,
		DownloadBps:        0,
		UploadBps:          0,
		FreeDiskBytes:      0,
	}, nil
}

func normalizeLoginEngine(engine string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "", "auto":
		return "builtin", nil
	case "builtin", "aria2", "qbittorrent":
		return strings.ToLower(strings.TrimSpace(engine)), nil
	default:
		return "", fmt.Errorf("unsupported downloader engine %q; expected auto, builtin, aria2, or qbittorrent", engine)
	}
}

func loginCapabilities(name string) []string {
	switch name {
	case "aria2", "qbittorrent":
		return []string{"http", "magnet", "torrent"}
	default:
		return []string{"http"}
	}
}
