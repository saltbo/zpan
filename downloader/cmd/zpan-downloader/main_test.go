package main

import (
	"testing"

	"github.com/saltbo/zpan/downloader/internal/config"
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

func TestRootCommandDoesNotExposeLoginCommand(t *testing.T) {
	for _, command := range rootCommand().Commands() {
		if command.Name() == "login" {
			t.Fatal("login command should not be exposed")
		}
	}
}
