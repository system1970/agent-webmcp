package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
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

// ensureChrome is superseded by ensureProfileBrowser (profile.go): one
// browser per profile, sessions bind to tabs. Kept symbols: findChrome,
// chromeArgs below.

func closeSession(session string) error {
	// Shared browser keeps running; only the session's tab closes.
	// Evidence stays; legacy per-session browsers die on sight.
	return closeSessionTab(session)
}
