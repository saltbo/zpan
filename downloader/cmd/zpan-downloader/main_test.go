package main

import (
	"testing"

	"github.com/spf13/viper"
)

func TestLoginHeartbeatNormalizesAutoEngine(t *testing.T) {
	v := viper.New()
	v.Set("engine", "auto")
	v.Set("max_concurrent_tasks", 3)

	heartbeat, err := loginHeartbeat(v)
	if err != nil {
		t.Fatal(err)
	}
	if heartbeat.Engine != "builtin" {
		t.Fatalf("expected builtin engine, got %q", heartbeat.Engine)
	}
	if len(heartbeat.Capabilities) != 1 || heartbeat.Capabilities[0] != "http" {
		t.Fatalf("expected http-only capabilities, got %#v", heartbeat.Capabilities)
	}
}

func TestLoginHeartbeatRejectsUnknownEngine(t *testing.T) {
	v := viper.New()
	v.Set("engine", "bad-engine")

	if _, err := loginHeartbeat(v); err == nil {
		t.Fatal("expected unsupported engine error")
	}
}
