//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func setupChildOS(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
