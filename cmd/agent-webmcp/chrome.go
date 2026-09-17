package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func findChrome(explicit string) (string, error) {
	candidates := []string{}
	if explicit != "" {
		candidates = append(candidates, explicit)
	}
	for _, env := range []string{"AGENT_WEBMCP_CHROME", "CHROME_PATH"} {
		if v := os.Getenv(env); v != "" {
			candidates = append(candidates, v)
		}
	}
	switch runtime.GOOS {
	case "windows":
		candidates = append(candidates,
			`C:\Program Files\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
			filepath.Join(os.Getenv("LOCALAPPDATA"), `Google\Chrome\Application\chrome.exe`),
			`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`,
		)
	case "darwin":
		candidates = append(candidates,
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		)
	default:
		candidates = append(candidates, "google-chrome", "chromium", "chromium-browser", "brave-browser")
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if filepath.IsAbs(c) || strings.ContainsAny(c, `/\`) {
			if st, err := os.Stat(c); err == nil && !st.IsDir() {
				return c, nil
			}
			continue
		}
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("chrome not found: install Chrome 149+ or pass --chrome <path>")
}

func chromeArgs(port int, profile string, headed bool) []string {
	args := []string{
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--remote-allow-origins=*",
		"--user-data-dir=" + profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-dev-shm-usage",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		"--enable-features=WebMCP,WebMCPTesting",
	}
	if extra := strings.Fields(os.Getenv("AGENT_WEBMCP_CHROME_FLAGS")); len(extra) > 0 {
		args = append(args, extra...)
	}
	if headed {
		args = append(args, "--start-maximized")
	} else {
		args = append(args, "--headless=new", "--hide-scrollbars", "--window-size=1440,900")
	}
	return append(args, "about:blank")
}

// ensureChrome reuses the session's live browser or launches a fresh one.
// The child outlives the CLI so consecutive calls share tabs and logins.
func ensureChrome(session, chromeBin string, headed bool, timeout time.Duration) (port int, reused bool, err error) {
	if port, err := readPort(session); err == nil {
		var v map[string]any
		if err := cdpGet(port, "/json/version", &v); err == nil {
			return port, true, nil
		}
	}
	if chromeBin == "" {
		if chromeBin, err = findChrome(""); err != nil {
			return 0, false, err
		}
	} else if chromeBin, err = findChrome(chromeBin); err != nil {
		return 0, false, err
	}
	if port, err = freePort(); err != nil {
		return 0, false, err
	}
	profile := filepath.Join(sessionDir(session), "profile")
	if err := os.MkdirAll(profile, 0o755); err != nil {
		return 0, false, err
	}
	logPath := filepath.Join(sessionDir(session), "chrome.log")
	log, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return 0, false, err
	}
	defer log.Close()
	cmd := exec.Command(chromeBin, chromeArgs(port, profile, headed)...)
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		return 0, false, fmt.Errorf("chrome launch failed: %w", err)
	}
	go cmd.Wait()
	_ = writePort(session, port)
	_ = writePid(session, cmd.Process.Pid)
	if err := waitCDP(port, timeout); err != nil {
		return 0, false, err
	}
	return port, false, nil
}

func closeSession(session string) error {
	if pid, err := readPid(session); err == nil && pid > 0 {
		if p, err := os.FindProcess(pid); err == nil {
			_ = p.Kill()
		}
	}
	_ = os.Remove(filepath.Join(sessionDir(session), "cdp-port"))
	_ = os.Remove(filepath.Join(sessionDir(session), "chrome.pid"))
	return nil // profile/ stays for fast relaunch
}
