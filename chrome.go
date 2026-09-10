package main

import (
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

var sharedHTTP = &http.Client{
	Transport: &http.Transport{
		MaxIdleConnsPerHost:   8,
		MaxConnsPerHost:       8,
		IdleConnTimeout:       30 * time.Second,
		DisableCompression:    true, // localhost: skip gzip for speed
		ResponseHeaderTimeout: 5 * time.Second,
	},
	Timeout: 8 * time.Second,
}

func findChrome(explicit string) string {
	if explicit != "" {
		return explicit
	}
	if v := os.Getenv("AGENT_WEBMCP_CHROME"); v != "" {
		return v
	}
	if v := os.Getenv("CHROME_PATH"); v != "" {
		return v
	}
	cands := []string{}
	if runtime.GOOS == "windows" {
		cands = append(cands,
			`C:\Program Files\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		)
		if h, _ := os.UserHomeDir(); h != "" {
			cands = append(cands, filepath.Join(h, `AppData\Local\Google\Chrome\Application\chrome.exe`))
		}
		for _, n := range []string{"chrome.exe", "chrome", "chromium.exe", "chromium"} {
			if p, err := exec.LookPath(n); err == nil {
				return p
			}
		}
	} else if runtime.GOOS == "darwin" {
		cands = append(cands,
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		)
		for _, n := range []string{"google-chrome", "chrome", "chromium", "chromium-browser"} {
			if p, err := exec.LookPath(n); err == nil {
				return p
			}
		}
	} else {
		for _, n := range []string{"google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser"} {
			if p, err := exec.LookPath(n); err == nil {
				return p
			}
		}
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// chromeArgs builds a fast, WebMCP-enabled launch.
func chromeArgs(port int, profile string, headed bool, extraBlank bool) []string {
	a := []string{
		"--remote-debugging-port=" + itoa(port),
		"--remote-allow-origins=*",
		"--user-data-dir=" + profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-dev-shm-usage",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		// WebMCP experimental flags (harmless on builds without them).
		"--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport",
		"--enable-webmcp-testing",
	}
	if !headed {
		a = append(a, "--headless=new", "--hide-scrollbars")
	} else {
		a = append(a, "--start-maximized")
	}
	if extraBlank {
		a = append(a, "about:blank")
	}
	return a
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
