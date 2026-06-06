package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/saltbo/zpan/cmd/internal/client"
	"github.com/saltbo/zpan/cmd/internal/config"
	"github.com/saltbo/zpan/cmd/internal/worker"
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
		Use:   "zpan",
		Short: "Command line tools for ZPan",
	}
	root.PersistentFlags().StringVar(&cfgFile, "config", config.DefaultConfigPath(), "config file")
	root.PersistentFlags().StringVar(&logLevel, "log-level", "info", "log level: debug, info, warn, error")
	root.PersistentPreRun = func(cmd *cobra.Command, args []string) {
		setLogLevel(logLevel)
		v.SetConfigFile(cfgFile)
	}

	root.AddCommand(configCommand(v, &cfgFile))
	root.AddCommand(downloaderCommand(v, &cfgFile))
	return root
}

func downloaderCommand(v *viper.Viper, cfgFile *string) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "downloader",
		Short: "Manage the ZPan remote downloader",
	}
	cmd.AddCommand(upCommand(v, cfgFile))
	return cmd
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

func upCommand(v *viper.Viper, cfgFile *string) *cobra.Command {
	return &cobra.Command{
		Use:   "up",
		Short: "Start the downloader worker",
		RunE: func(cmd *cobra.Command, args []string) error {
			slog.Info("loading downloader config")
			cfg, err := config.Load(v)
			if err != nil {
				return err
			}
			if err := validateConfiguredEngine(cfg.Engine); err != nil {
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
			if cfg.Token == "" {
				registered, err := registerDownloaderWithDeviceLogin(ctx, cmd, v, cfg, *cfgFile)
				if err != nil {
					return err
				}
				cfg.Token = registered.Token
			}
			downloader, err := worker.New(cfg)
			if err != nil {
				return err
			}
			return downloader.Run(ctx)
		},
	}
}

func configCommand(v *viper.Viper, cfgFile *string) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage CLI configuration",
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

func registerDownloaderWithDeviceLogin(
	ctx context.Context,
	cmd *cobra.Command,
	v *viper.Viper,
	cfg config.Config,
	cfgFile string,
) (client.CreateDownloaderResponse, error) {
	slog.Info("starting downloader device login")
	api, err := client.New(cfg.ServerURL, "")
	if err != nil {
		return client.CreateDownloaderResponse{}, err
	}
	slog.Info("requesting device login code", "server_url", cfg.ServerURL)
	code, err := api.RequestDeviceCode(ctx)
	if err != nil {
		return client.CreateDownloaderResponse{}, err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Open this URL to authorize the downloader:\n%s\n\n", code.VerificationURIComplete)
	fmt.Fprintf(cmd.OutOrStdout(), "User code: %s\n", code.UserCode)

	slog.Info("waiting for device authorization", "user_code", code.UserCode)
	token, err := pollDeviceToken(ctx, api, code)
	if err != nil {
		return client.CreateDownloaderResponse{}, err
	}
	slog.Info("device authorization completed")
	registered, err := api.CreateDownloader(ctx, token.AccessToken, client.CreateDownloaderRequest{
		Name:      downloaderName(),
		Heartbeat: registrationHeartbeat(cfg),
	})
	if err != nil {
		return client.CreateDownloaderResponse{}, err
	}
	slog.Info("downloader registered", "downloader_id", registered.Downloader.ID)
	if err := saveRegisteredDownloaderConfig(v, cfg, cfgFile, registered.Token); err != nil {
		return client.CreateDownloaderResponse{}, err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Downloader registered: %s\n", registered.Downloader.ID)
	fmt.Fprintf(cmd.OutOrStdout(), "Config saved: %s\n", cfgFile)
	return registered, nil
}

func saveRegisteredDownloaderConfig(v *viper.Viper, cfg config.Config, cfgFile string, token string) error {
	v.Set("server_url", cfg.ServerURL)
	v.Set("downloader.token", token)
	if err := os.MkdirAll(filepath.Dir(cfgFile), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(cfgFile); err == nil {
		return v.WriteConfigAs(cfgFile)
	}
	return v.SafeWriteConfigAs(cfgFile)
}

func downloaderName() string {
	hostname, _ := os.Hostname()
	if hostname != "" {
		return hostname
	}
	return "zpan"
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

func registrationHeartbeat(cfg config.Config) client.Heartbeat {
	hostname, _ := os.Hostname()
	engine := normalizeRegistrationEngine(cfg)
	return client.Heartbeat{
		Version:            worker.Version,
		Hostname:           hostname,
		Platform:           runtime.GOOS,
		Arch:               runtime.GOARCH,
		Engine:             engine,
		Capabilities:       runtimeCapabilities(engine),
		MaxConcurrentTasks: cfg.MaxConcurrentTasks,
		CurrentTasks:       0,
		DownloadBps:        0,
		UploadBps:          0,
		FreeDiskBytes:      0,
	}
}

func normalizeRegistrationEngine(cfg config.Config) string {
	switch strings.ToLower(strings.TrimSpace(cfg.Engine)) {
	case "aria2", "qbittorrent", "builtin":
		return strings.ToLower(strings.TrimSpace(cfg.Engine))
	}
	if cfg.Aria2Configured {
		return "aria2"
	}
	if cfg.QBittorrentConfigured {
		return "qbittorrent"
	}
	return "builtin"
}

func validateConfiguredEngine(engine string) error {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "", "auto", "builtin", "aria2", "qbittorrent":
		return nil
	default:
		return fmt.Errorf("unsupported downloader engine %q; expected auto, builtin, aria2, or qbittorrent", engine)
	}
}

func runtimeCapabilities(name string) []string {
	switch name {
	case "aria2", "qbittorrent":
		return []string{"http", "magnet", "torrent"}
	default:
		return []string{"http"}
	}
}
