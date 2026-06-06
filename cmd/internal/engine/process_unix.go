//go:build !windows

package engine

import (
	"os/exec"
	"syscall"
)

func configureEngineProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
