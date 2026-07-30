package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/rest-sh/restish/v2/plugin"
)

func TestManifestContract(t *testing.T) {
	var out bytes.Buffer
	err := plugin.WriteManifest(&out, manifest())
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err := plugin.NewDecoder(&out).ReadMessage(&manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Name != "zpan" || manifest.NeedsAuthSecrets || len(manifest.Hooks) != 1 || manifest.Hooks[0] != "command" {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
}

func TestCommandDiscoveryContract(t *testing.T) {
	var out bytes.Buffer
	if err := plugin.WriteCommands(&out, commands()); err != nil {
		t.Fatal(err)
	}
	var discovery plugin.CommandDiscoveryResponse
	if err := plugin.NewDecoder(&out).ReadMessage(&discovery); err != nil {
		t.Fatal(err)
	}
	if len(discovery.Commands) != 1 || discovery.Commands[0].Name != "zpan-upload" {
		t.Fatalf("unexpected commands: %#v", discovery.Commands)
	}
	help := discovery.Commands[0].Long
	if !strings.Contains(help, "RSH_PROFILE=file-manager") || strings.Contains(help, "--rsh-profile") {
		t.Fatalf("upload help must use the delegated HTTP profile environment: %q", help)
	}
}

func TestRunCommandRejectsUnknownCommand(t *testing.T) {
	err := runCommand("other", nil, plugin.NewCommandClient(bytes.NewReader(nil), io.Discard))
	if err == nil {
		t.Fatal("expected unknown command to fail")
	}
}

func TestRunCommandDelegatesKnownCommand(t *testing.T) {
	err := runCommand("zpan-upload", nil, plugin.NewCommandClient(bytes.NewReader(nil), io.Discard))
	if err == nil {
		t.Fatal("expected delegated parser error")
	}
}

func TestMainStartupFlags(t *testing.T) {
	t.Run("manifest", func(t *testing.T) {
		data := captureStdout(t, []string{"restish-zpan", plugin.StartupFlagManifest}, main)
		var manifest plugin.Manifest
		if err := plugin.NewDecoder(bytes.NewReader(data)).ReadMessage(&manifest); err != nil {
			t.Fatal(err)
		}
		if manifest.Name != "zpan" || manifest.RestishAPIVersion != 2 {
			t.Fatalf("unexpected manifest: %#v", manifest)
		}
	})

	t.Run("commands", func(t *testing.T) {
		data := captureStdout(t, []string{"restish-zpan", plugin.StartupFlagCommands}, main)
		var discovery plugin.CommandDiscoveryResponse
		if err := plugin.NewDecoder(bytes.NewReader(data)).ReadMessage(&discovery); err != nil {
			t.Fatal(err)
		}
		if len(discovery.Commands) != 1 || discovery.Commands[0].Name != "zpan-upload" {
			t.Fatalf("unexpected commands: %#v", discovery.Commands)
		}
	})
}

func TestMainCommandErrorPath(t *testing.T) {
	oldArgs := os.Args
	oldStdin := os.Stdin
	oldStdout := os.Stdout
	defer func() {
		os.Args = oldArgs
		os.Stdin = oldStdin
		os.Stdout = oldStdout
	}()

	inR, inW, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	outR, outW, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Args = []string{"restish-zpan"}
	os.Stdin = inR
	os.Stdout = outW

	go func() {
		defer inW.Close()
		_ = plugin.WriteMessage(inW, plugin.InitMsg{Type: plugin.MsgTypeInit, Command: "unknown"})
	}()

	main()

	if err := outW.Close(); err != nil {
		t.Fatal(err)
	}
	var stderr plugin.StderrDataMsg
	dec := plugin.NewDecoder(outR)
	if err := dec.ReadMessage(&stderr); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(stderr.Data, []byte("unknown command: unknown")) {
		t.Fatalf("unexpected stderr: %q", stderr.Data)
	}
	var done plugin.DoneMsg
	if err := dec.ReadMessage(&done); err != nil {
		t.Fatal(err)
	}
	if done.ExitCode != 1 {
		t.Fatalf("exit code = %d, want 1", done.ExitCode)
	}
	if err := outR.Close(); err != nil {
		t.Fatal(err)
	}
	if err := inR.Close(); err != nil {
		t.Fatal(err)
	}
}

func captureStdout(t *testing.T, args []string, fn func()) []byte {
	t.Helper()
	oldArgs := os.Args
	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Args = args
	os.Stdout = w
	defer func() {
		os.Args = oldArgs
		os.Stdout = oldStdout
	}()

	fn()

	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	return data
}
