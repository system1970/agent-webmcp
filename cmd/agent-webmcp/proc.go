package main

import "os/exec"

// setupChild detaches Chrome so it outlives the CLI.
// Platform-specific tweaks live in proc_unix.go / proc_windows.go.
func setupChild(cmd *exec.Cmd) {
	setupChildOS(cmd)
}
