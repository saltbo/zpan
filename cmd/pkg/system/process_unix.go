//go:build !windows

package system

import (
	"os/exec"
	"syscall"
)

func ConfigureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
