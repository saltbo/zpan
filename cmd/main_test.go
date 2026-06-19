package main

import (
	"testing"

	"github.com/saltbo/zpan/internal/config"
)

func TestRegistrationHeartbeatNormalizesAutoEngine(t *testing.T) {
	heartbeat := registrationHeartbeat(config.Config{Engine: "auto", MaxConcurrentTasks: 3})
	if heartbeat.Engine != "builtin" {
		t.Fatalf("expected builtin engine, got %q", heartbeat.Engine)
	}
	if len(heartbeat.Capabilities) != 1 || heartbeat.Capabilities[0] != "http" {
		t.Fatalf("expected http-only capabilities, got %#v", heartbeat.Capabilities)
	}
}

func TestRegistrationHeartbeatUsesConfiguredExternalEngine(t *testing.T) {
	heartbeat := registrationHeartbeat(config.Config{Engine: "auto", MaxConcurrentTasks: 2, Aria2Configured: true})
	if heartbeat.Engine != "aria2" {
		t.Fatalf("expected aria2 engine, got %q", heartbeat.Engine)
	}
}

func TestValidateConfiguredEngineRejectsUnknownEngine(t *testing.T) {
	if err := validateConfiguredEngine("bad-engine"); err == nil {
		t.Fatal("expected unsupported engine error")
	}
}

func TestRootCommandExposesDownloaderSubcommands(t *testing.T) {
	root := rootCommand()
	if root.Name() != "zpan" {
		t.Fatalf("expected root command zpan, got %q", root.Name())
	}
	for _, command := range rootCommand().Commands() {
		if command.Name() == "login" {
			t.Fatal("login command should not be exposed")
		}
		if command.Name() == "run" {
			t.Fatal("run command should not be exposed at root")
		}
	}
	downloader, _, err := root.Find([]string{"downloader", "up"})
	if err != nil {
		t.Fatal(err)
	}
	if downloader.Name() != "up" {
		t.Fatalf("expected downloader up command, got %q", downloader.Name())
	}
	config, _, err := root.Find([]string{"config", "init"})
	if err != nil {
		t.Fatal(err)
	}
	if config.Name() != "init" {
		t.Fatalf("expected root config init command, got %q", config.Name())
	}
	if config.Flags().Lookup("server-url") == nil {
		t.Fatal("expected config init --server-url flag")
	}
	if command, _, err := root.Find([]string{"downloader", "config"}); err == nil && command.Name() == "config" {
		t.Fatal("downloader config command should not be exposed")
	}
}
