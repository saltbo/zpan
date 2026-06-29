//go:build !windows

package system

import (
	"os/exec"
	"testing"
)

func TestConfigureProcessSetsProcessGroup(t *testing.T) {
	cmd := exec.Command("go", "version")
	ConfigureProcess(cmd)
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.Setpgid {
		t.Fatalf("expected process group configuration, got %#v", cmd.SysProcAttr)
	}
}
