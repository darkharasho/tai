# Remote Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Go daemon (`tai-daemon`) that runs on remote hosts and gives Claude full tool parity + managed LSP, replacing the fragile shell-fencing agentless approach.

**Architecture:** A Go binary with two modes — `--serve` (persistent background process on Unix socket) and `--connect` (stdio gateway; starts `--serve` if needed, then bridges stdin/stdout ↔ socket). TAI replaces `RemoteToolProxy` with `RemoteDaemonProxy` which speaks newline-delimited JSON over an SSH stdio channel. Agentless path stays as fallback.

**Tech Stack:** Go 1.22 (daemon), `github.com/bmatcuk/doublestar/v4` (glob), TypeScript/Electron (TAI integration), `execFile`/`spawn` for SSH + scp.

---

## File Map

**New Go files (daemon/):**
- `daemon/go.mod` — Go module definition
- `daemon/protocol.go` — all JSON request/response types + Version constant
- `daemon/tools.go` — `ToolExecutor` with Bash, Read, Write, Edit, Grep, Glob
- `daemon/tools_test.go` — unit tests for each tool
- `daemon/lsp.go` — `LSPManager`: language server registry, lifecycle, JSON-RPC proxy
- `daemon/lsp_test.go` — tests for LSP framing + error paths
- `daemon/server.go` — `Server`: Unix socket listener, request router, connection handler
- `daemon/server_test.go` — integration tests via real Unix socket
- `daemon/gateway.go` — `--connect` mode: check/start daemon, bridge stdio ↔ socket
- `daemon/gateway_test.go` — tests for `isDaemonRunning`
- `daemon/main.go` — entry point, flag parsing, `runServer`/`runGateway` dispatch
- `daemon/Makefile` — cross-compile targets for linux/amd64, linux/arm64, darwin/amd64, darwin/arm64
- `daemon/dist/` — compiled binaries (git-ignored, built by Makefile)

**New TypeScript/React files:**
- `electron/services/remoteDaemonProxy.ts` — manages SSH+daemon connection, JSON protocol, tool routing per tab key
- `src/components/DaemonInstallCard.tsx` — install/update/cancel prompt card

**Modified files:**
- `electron/services/claude.ts` — add `daemonProxy`, `daemonEnabled` state, daemon-first routing in `handleRemoteToolCalls`, `ai:setDaemonEnabled` IPC handler
- `electron/main.ts` — add `tai:daemon:check` and `tai:daemon:install` IPC handlers
- `electron/preload.ts` — expose `window.tai.daemon.check` and `window.tai.daemon.install`
- `src/components/TerminalSession.tsx` — check daemon on SSH detect, show install card, call `setDaemonEnabled`
- `package.json` — add `extraResources` for `daemon/dist/` binaries

---

## Task 1: Go module + protocol types

**Files:**
- Create: `daemon/go.mod`
- Create: `daemon/go.sum` (auto-generated)
- Create: `daemon/protocol.go`

- [ ] **Step 1: Init Go module**

```bash
mkdir -p daemon && cd daemon && go mod init tai-daemon && go get github.com/bmatcuk/doublestar/v4
```

Expected: `go.mod` and `go.sum` created.

- [ ] **Step 2: Write protocol.go**

Create `daemon/protocol.go`:

```go
package main

import "encoding/json"

const Version = "1.2.4"

type Request struct {
	ID     string          `json:"id,omitempty"`
	Type   string          `json:"type,omitempty"`
	Tool   string          `json:"tool,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	ID     string      `json:"id,omitempty"`
	Type   string      `json:"type,omitempty"`
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

type ReadyMessage struct {
	Type         string   `json:"type"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

type BashParams struct {
	Command string `json:"command"`
	Cwd     string `json:"cwd"`
	Timeout int    `json:"timeout"`
}

type BashResult struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
}

type ReadParams struct {
	Path   string `json:"path"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
}

type ReadResult struct {
	Content string `json:"content"`
}

type WriteParams struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type EditParams struct {
	Path      string `json:"path"`
	OldString string `json:"old_string"`
	NewString string `json:"new_string"`
}

type GrepParams struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path"`
	Glob    string `json:"glob,omitempty"`
}

type GrepResult struct {
	Output string `json:"output"`
}

type GlobParams struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path,omitempty"`
}

type GlobResult struct {
	Files []string `json:"files"`
}

type LspParams struct {
	Language string          `json:"language"`
	Method   string          `json:"method"`
	Params   json.RawMessage `json:"params"`
}
```

- [ ] **Step 3: Verify compile**

```bash
cd daemon && go build ./...
```

Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add daemon/go.mod daemon/go.sum daemon/protocol.go
git commit -m "feat(daemon): Go module and protocol types"
```

---

## Task 2: Tool executor — Bash and Read

**Files:**
- Create: `daemon/tools.go` (partial — Bash + Read only)
- Create: `daemon/tools_test.go` (Bash + Read tests)

- [ ] **Step 1: Write failing tests for Bash and Read**

Create `daemon/tools_test.go`:

```go
package main

import (
	"os"
	"testing"
)

func TestExecuteBashOutput(t *testing.T) {
	ex := NewToolExecutor()
	result, err := ex.ExecuteBash(BashParams{Command: "echo hello", Timeout: 5000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Output != "hello" {
		t.Fatalf("expected 'hello', got %q", result.Output)
	}
	if result.ExitCode != 0 {
		t.Fatalf("expected exit code 0, got %d", result.ExitCode)
	}
}

func TestExecuteBashCwdTracking(t *testing.T) {
	ex := NewToolExecutor()
	_, err := ex.ExecuteBash(BashParams{Command: "cd /tmp", Timeout: 5000})
	if err != nil {
		t.Fatal(err)
	}
	if ex.Cwd() != "/tmp" {
		t.Fatalf("expected cwd /tmp, got %q", ex.Cwd())
	}
}

func TestExecuteBashTimeout(t *testing.T) {
	ex := NewToolExecutor()
	_, err := ex.ExecuteBash(BashParams{Command: "sleep 10", Timeout: 100})
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestExecuteBashExitCode(t *testing.T) {
	ex := NewToolExecutor()
	result, err := ex.ExecuteBash(BashParams{Command: "exit 2", Timeout: 5000})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode != 2 {
		t.Fatalf("expected exit code 2, got %d", result.ExitCode)
	}
}

func TestExecuteRead(t *testing.T) {
	tmp, err := os.CreateTemp("", "tai-test-*.txt")
	if err != nil {
		t.Fatal(err)
	}
	tmp.WriteString("line1\nline2\nline3\n")
	tmp.Close()
	defer os.Remove(tmp.Name())

	ex := NewToolExecutor()
	result, err := ex.ExecuteRead(ReadParams{Path: tmp.Name()})
	if err != nil {
		t.Fatal(err)
	}
	expected := "1\tline1\n2\tline2\n3\tline3\n"
	if result.Content != expected {
		t.Fatalf("expected %q, got %q", expected, result.Content)
	}
}

func TestExecuteReadOffsetLimit(t *testing.T) {
	tmp, err := os.CreateTemp("", "tai-test-*.txt")
	if err != nil {
		t.Fatal(err)
	}
	tmp.WriteString("line1\nline2\nline3\n")
	tmp.Close()
	defer os.Remove(tmp.Name())

	ex := NewToolExecutor()
	result, err := ex.ExecuteRead(ReadParams{Path: tmp.Name(), Offset: 2, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.Content != "2\tline2\n" {
		t.Fatalf("expected %q, got %q", "2\tline2\n", result.Content)
	}
}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd daemon && go test ./... -run "TestExecuteBash|TestExecuteRead" -v 2>&1 | head -20
```

Expected: compile error — `NewToolExecutor` undefined.

- [ ] **Step 3: Write tools.go with Bash + Read**

Create `daemon/tools.go`:

```go
package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/bmatcuk/doublestar/v4"
)

const maxOutputBytes = 200 * 1024

type ToolExecutor struct {
	cwd   string
	cwdMu sync.RWMutex
}

func NewToolExecutor() *ToolExecutor {
	cwd, _ := os.Getwd()
	return &ToolExecutor{cwd: cwd}
}

func (t *ToolExecutor) Cwd() string {
	t.cwdMu.RLock()
	defer t.cwdMu.RUnlock()
	return t.cwd
}

func (t *ToolExecutor) ExecuteBash(p BashParams) (BashResult, error) {
	cwd := p.Cwd
	if cwd == "" {
		cwd = t.Cwd()
	}
	timeout := time.Duration(p.Timeout) * time.Millisecond
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	cmd := p.Command + "; echo __TAI_CWD__; pwd"

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	c := exec.CommandContext(ctx, "bash", "-c", cmd)
	c.Dir = cwd
	c.Env = os.Environ()

	var out bytes.Buffer
	c.Stdout = &out
	c.Stderr = &out

	err := c.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if ctx.Err() == context.DeadlineExceeded {
			return BashResult{}, fmt.Errorf("command timed out after %v", timeout)
		}
	}

	output := out.String()
	if idx := strings.LastIndex(output, "__TAI_CWD__\n"); idx != -1 {
		newCwd := strings.TrimSpace(output[idx+len("__TAI_CWD__\n"):])
		output = output[:idx]
		if newCwd != "" {
			t.cwdMu.Lock()
			t.cwd = newCwd
			t.cwdMu.Unlock()
		}
	}

	if len(output) > maxOutputBytes {
		output = output[:maxOutputBytes] + "\n[output truncated at 200KB]"
	}

	return BashResult{Output: strings.TrimRight(output, "\n"), ExitCode: exitCode}, nil
}

func (t *ToolExecutor) ExecuteRead(p ReadParams) (ReadResult, error) {
	data, err := os.ReadFile(p.Path)
	if err != nil {
		return ReadResult{}, err
	}

	lines := strings.Split(string(data), "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}

	start := 0
	if p.Offset > 1 {
		start = p.Offset - 1
	}
	if start >= len(lines) {
		return ReadResult{Content: ""}, nil
	}

	end := len(lines)
	if p.Limit > 0 && start+p.Limit < end {
		end = start + p.Limit
	}

	var sb strings.Builder
	for i, line := range lines[start:end] {
		fmt.Fprintf(&sb, "%d\t%s\n", start+i+1, line)
	}

	content := sb.String()
	if len(content) > maxOutputBytes {
		content = content[:maxOutputBytes] + "\n[output truncated at 200KB]"
	}

	return ReadResult{Content: content}, nil
}

// ExecuteWrite, ExecuteEdit, ExecuteGrep, ExecuteGlob added in Task 3 and 4.
func (t *ToolExecutor) ExecuteWrite(p WriteParams) error  { return fmt.Errorf("not implemented") }
func (t *ToolExecutor) ExecuteEdit(p EditParams) error    { return fmt.Errorf("not implemented") }
func (t *ToolExecutor) ExecuteGrep(p GrepParams) (GrepResult, error) {
	return GrepResult{}, fmt.Errorf("not implemented")
}
func (t *ToolExecutor) ExecuteGlob(p GlobParams) (GlobResult, error) {
	return GlobResult{}, fmt.Errorf("not implemented")
}

// keep doublestar import used
var _ = doublestar.Glob
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd daemon && go test ./... -run "TestExecuteBash|TestExecuteRead" -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/tools.go daemon/tools_test.go
git commit -m "feat(daemon): Bash and Read tool executor"
```

---

## Task 3: Tool executor — Write and Edit

**Files:**
- Modify: `daemon/tools.go` (replace Write + Edit stubs)
- Modify: `daemon/tools_test.go` (add Write + Edit tests)

- [ ] **Step 1: Add failing tests for Write and Edit**

Append to `daemon/tools_test.go`:

```go
func TestExecuteWrite(t *testing.T) {
	dir, err := os.MkdirTemp("", "tai-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	path := dir + "/sub/file.txt"

	ex := NewToolExecutor()
	if err := ex.ExecuteWrite(WriteParams{Path: path, Content: "hello world"}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "hello world" {
		t.Fatalf("unexpected content: %q", string(data))
	}
}

func TestExecuteWriteCreatesParentDirs(t *testing.T) {
	dir, _ := os.MkdirTemp("", "tai-test-*")
	defer os.RemoveAll(dir)
	path := dir + "/a/b/c/file.txt"

	ex := NewToolExecutor()
	if err := ex.ExecuteWrite(WriteParams{Path: path, Content: "nested"}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "nested" {
		t.Fatalf("expected 'nested', got %q", string(data))
	}
}

func TestExecuteEdit(t *testing.T) {
	tmp, _ := os.CreateTemp("", "tai-test-*.txt")
	tmp.WriteString("hello world")
	tmp.Close()
	defer os.Remove(tmp.Name())

	ex := NewToolExecutor()
	if err := ex.ExecuteEdit(EditParams{Path: tmp.Name(), OldString: "world", NewString: "there"}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(tmp.Name())
	if string(data) != "hello there" {
		t.Fatalf("expected 'hello there', got %q", string(data))
	}
}

func TestExecuteEditNotFound(t *testing.T) {
	tmp, _ := os.CreateTemp("", "tai-test-*.txt")
	tmp.WriteString("hello world")
	tmp.Close()
	defer os.Remove(tmp.Name())

	ex := NewToolExecutor()
	err := ex.ExecuteEdit(EditParams{Path: tmp.Name(), OldString: "missing", NewString: "x"})
	if err == nil {
		t.Fatal("expected error for missing old_string")
	}
}

func TestExecuteEditAmbiguous(t *testing.T) {
	tmp, _ := os.CreateTemp("", "tai-test-*.txt")
	tmp.WriteString("foo foo")
	tmp.Close()
	defer os.Remove(tmp.Name())

	ex := NewToolExecutor()
	err := ex.ExecuteEdit(EditParams{Path: tmp.Name(), OldString: "foo", NewString: "bar"})
	if err == nil {
		t.Fatal("expected error for ambiguous old_string")
	}
}
```

- [ ] **Step 2: Run — verify they fail**

```bash
cd daemon && go test ./... -run "TestExecuteWrite|TestExecuteEdit" -v 2>&1 | grep -E "FAIL|not implemented"
```

Expected: FAIL with "not implemented".

- [ ] **Step 3: Replace Write + Edit stubs in tools.go**

Replace the stub implementations for `ExecuteWrite` and `ExecuteEdit` in `daemon/tools.go`:

```go
func (t *ToolExecutor) ExecuteWrite(p WriteParams) error {
	if err := os.MkdirAll(filepath.Dir(p.Path), 0755); err != nil {
		return err
	}
	tmp := p.Path + ".tai-tmp"
	if err := os.WriteFile(tmp, []byte(p.Content), 0644); err != nil {
		return err
	}
	return os.Rename(tmp, p.Path)
}

func (t *ToolExecutor) ExecuteEdit(p EditParams) error {
	data, err := os.ReadFile(p.Path)
	if err != nil {
		return err
	}
	content := string(data)
	count := strings.Count(content, p.OldString)
	if count == 0 {
		return fmt.Errorf("old_string not found in %s", p.Path)
	}
	if count > 1 {
		return fmt.Errorf("old_string found %d times in %s; must be unique", count, p.Path)
	}
	newContent := strings.Replace(content, p.OldString, p.NewString, 1)
	tmp := p.Path + ".tai-tmp"
	if err := os.WriteFile(tmp, []byte(newContent), 0644); err != nil {
		return err
	}
	return os.Rename(tmp, p.Path)
}
```

Also add `"path/filepath"` to the import block in `daemon/tools.go`.

- [ ] **Step 4: Run — verify they pass**

```bash
cd daemon && go test ./... -run "TestExecuteWrite|TestExecuteEdit" -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/tools.go daemon/tools_test.go
git commit -m "feat(daemon): Write and Edit tool executor"
```

---

## Task 4: Tool executor — Grep and Glob

**Files:**
- Modify: `daemon/tools.go` (replace Grep + Glob stubs)
- Modify: `daemon/tools_test.go` (add Grep + Glob tests)

- [ ] **Step 1: Add failing tests**

Append to `daemon/tools_test.go`:

```go
func TestExecuteGlob(t *testing.T) {
	dir, _ := os.MkdirTemp("", "tai-test-*")
	defer os.RemoveAll(dir)
	os.WriteFile(dir+"/a.go", []byte(""), 0644)
	os.WriteFile(dir+"/b.go", []byte(""), 0644)
	os.WriteFile(dir+"/c.txt", []byte(""), 0644)

	ex := NewToolExecutor()
	result, err := ex.ExecuteGlob(GlobParams{Pattern: "*.go", Path: dir})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Files) != 2 {
		t.Fatalf("expected 2 .go files, got %d: %v", len(result.Files), result.Files)
	}
}

func TestExecuteGlobNoMatches(t *testing.T) {
	dir, _ := os.MkdirTemp("", "tai-test-*")
	defer os.RemoveAll(dir)

	ex := NewToolExecutor()
	result, err := ex.ExecuteGlob(GlobParams{Pattern: "*.rs", Path: dir})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Files) != 0 {
		t.Fatalf("expected 0 files, got %d", len(result.Files))
	}
}

func TestExecuteGrep(t *testing.T) {
	dir, _ := os.MkdirTemp("", "tai-test-*")
	defer os.RemoveAll(dir)
	os.WriteFile(dir+"/file.txt", []byte("hello world\ngoodbye world\n"), 0644)

	ex := NewToolExecutor()
	result, err := ex.ExecuteGrep(GrepParams{Pattern: "hello", Path: dir})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Output, "hello") {
		t.Fatalf("expected 'hello' in output, got %q", result.Output)
	}
}
```

- [ ] **Step 2: Run — verify they fail**

```bash
cd daemon && go test ./... -run "TestExecuteGlob|TestExecuteGrep" -v 2>&1 | grep -E "FAIL|not implemented"
```

Expected: FAIL with "not implemented".

- [ ] **Step 3: Replace Grep + Glob stubs in tools.go**

Replace stub implementations in `daemon/tools.go`:

```go
func (t *ToolExecutor) ExecuteGrep(p GrepParams) (GrepResult, error) {
	var args []string
	var cmdName string

	if _, err := exec.LookPath("rg"); err == nil {
		cmdName = "rg"
		args = []string{"--line-number", "--no-heading"}
		if p.Glob != "" {
			args = append(args, "--glob", p.Glob)
		}
		args = append(args, p.Pattern)
		if p.Path != "" {
			args = append(args, p.Path)
		}
	} else {
		cmdName = "grep"
		args = []string{"-rn", p.Pattern}
		if p.Path != "" {
			args = append(args, p.Path)
		}
	}

	var out bytes.Buffer
	c := exec.Command(cmdName, args...)
	c.Stdout = &out
	c.Stderr = &out
	_ = c.Run() // grep exits 1 for no matches — not an error

	output := out.String()
	if len(output) > maxOutputBytes {
		output = output[:maxOutputBytes] + "\n[output truncated at 200KB]"
	}
	return GrepResult{Output: output}, nil
}

func (t *ToolExecutor) ExecuteGlob(p GlobParams) (GlobResult, error) {
	base := p.Path
	if base == "" {
		base = t.Cwd()
	}
	matches, err := doublestar.Glob(os.DirFS(base), p.Pattern)
	if err != nil {
		return GlobResult{}, err
	}
	if matches == nil {
		matches = []string{}
	}
	return GlobResult{Files: matches}, nil
}
```

Also remove the placeholder `var _ = doublestar.Glob` line since Glob now uses it directly.

- [ ] **Step 4: Run all tool tests**

```bash
cd daemon && go test ./... -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/tools.go daemon/tools_test.go
git commit -m "feat(daemon): Grep and Glob tool executor"
```

---

## Task 5: Server (Unix socket + request routing)

**Files:**
- Create: `daemon/server.go`
- Create: `daemon/server_test.go`

- [ ] **Step 1: Write failing server tests**

Create `daemon/server_test.go`:

```go
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func startTestServer(t *testing.T) (socketPath string, cancel context.CancelFunc) {
	t.Helper()
	dir, err := os.MkdirTemp("", "tai-server-test-*")
	if err != nil {
		t.Fatal(err)
	}
	socketPath = filepath.Join(dir, "daemon.sock")
	ctx, cancel := context.WithCancel(context.Background())

	s := NewServer(socketPath)
	go func() {
		if err := s.Run(ctx); err != nil && ctx.Err() == nil {
			t.Errorf("server error: %v", err)
		}
		os.RemoveAll(dir)
	}()
	time.Sleep(50 * time.Millisecond)
	return socketPath, cancel
}

func connectAndReady(t *testing.T, socketPath string) (net.Conn, *bufio.Scanner) {
	t.Helper()
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(conn)
	scanner.Scan()
	var msg map[string]interface{}
	if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil || msg["type"] != "ready" {
		t.Fatalf("expected ready message, got: %s", scanner.Bytes())
	}
	return conn, scanner
}

func TestServerSendsReady(t *testing.T) {
	socketPath, cancel := startTestServer(t)
	defer cancel()

	conn, _ := connectAndReady(t, socketPath)
	conn.Close()
}

func TestServerBashTool(t *testing.T) {
	socketPath, cancel := startTestServer(t)
	defer cancel()

	conn, scanner := connectAndReady(t, socketPath)
	defer conn.Close()

	req := Request{ID: "t1", Tool: "bash", Params: json.RawMessage(`{"command":"echo hello","timeout":5000}`)}
	data, _ := json.Marshal(req)
	conn.Write(append(data, '\n'))

	scanner.Scan()
	var resp Response
	json.Unmarshal(scanner.Bytes(), &resp)

	if resp.ID != "t1" {
		t.Fatalf("expected id t1, got %q", resp.ID)
	}
	resultData, _ := json.Marshal(resp.Result)
	var result BashResult
	json.Unmarshal(resultData, &result)
	if result.Output != "hello" {
		t.Fatalf("expected 'hello', got %q", result.Output)
	}
}

func TestServerPingPong(t *testing.T) {
	socketPath, cancel := startTestServer(t)
	defer cancel()

	conn, scanner := connectAndReady(t, socketPath)
	defer conn.Close()

	conn.Write([]byte("{\"type\":\"ping\"}\n"))
	scanner.Scan()
	var msg map[string]interface{}
	json.Unmarshal(scanner.Bytes(), &msg)
	if msg["type"] != "pong" {
		t.Fatalf("expected pong, got %v", msg)
	}
}

func TestServerUnknownTool(t *testing.T) {
	socketPath, cancel := startTestServer(t)
	defer cancel()

	conn, scanner := connectAndReady(t, socketPath)
	defer conn.Close()

	req := Request{ID: "t2", Tool: "doesnotexist", Params: json.RawMessage(`{}`)}
	data, _ := json.Marshal(req)
	conn.Write(append(data, '\n'))

	scanner.Scan()
	var resp Response
	json.Unmarshal(scanner.Bytes(), &resp)
	if resp.Error == "" {
		t.Fatal("expected error for unknown tool")
	}
}
```

- [ ] **Step 2: Run — verify they fail**

```bash
cd daemon && go test ./... -run "TestServer" -v 2>&1 | head -10
```

Expected: compile error — `NewServer` undefined.

- [ ] **Step 3: Write server.go**

Create `daemon/server.go`:

```go
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"sync"
)

type connWriter struct {
	conn net.Conn
	mu   sync.Mutex
}

func (w *connWriter) writeJSON(v interface{}) {
	w.mu.Lock()
	defer w.mu.Unlock()
	data, _ := json.Marshal(v)
	w.conn.Write(append(data, '\n'))
}

type Server struct {
	socketPath string
	tools      *ToolExecutor
	lsp        *LSPManager
}

func NewServer(socketPath string) *Server {
	return &Server{
		socketPath: socketPath,
		tools:      NewToolExecutor(),
		lsp:        NewLSPManager(nil),
	}
}

func (s *Server) Run(ctx context.Context) error {
	os.Remove(s.socketPath)
	ln, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return err
	}
	defer ln.Close()
	defer s.lsp.Shutdown()

	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go s.handleConn(conn)
	}
}

func (s *Server) handleConn(conn net.Conn) {
	defer conn.Close()
	w := &connWriter{conn: conn}

	s.lsp.SetNotifyFunc(func(language, method string, params json.RawMessage) {
		w.writeJSON(map[string]interface{}{
			"type":     "lsp_notify",
			"language": language,
			"method":   method,
			"params":   params,
		})
	})

	w.writeJSON(ReadyMessage{
		Type:         "ready",
		Version:      Version,
		Capabilities: []string{"bash", "read", "write", "edit", "grep", "glob", "lsp"},
	})

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 1*1024*1024), 1*1024*1024)

	for scanner.Scan() {
		var req Request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			continue
		}
		if req.Type == "ping" {
			w.writeJSON(Response{Type: "pong"})
			continue
		}
		go func(req Request) {
			result, err := s.dispatch(req)
			if err != nil {
				w.writeJSON(Response{ID: req.ID, Error: err.Error()})
			} else {
				w.writeJSON(Response{ID: req.ID, Result: result})
			}
		}(req)
	}
}

func (s *Server) dispatch(req Request) (interface{}, error) {
	switch req.Tool {
	case "bash":
		var p BashParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
		return s.tools.ExecuteBash(p)
	case "read":
		var p ReadParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
		return s.tools.ExecuteRead(p)
	case "write":
		var p WriteParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
		return nil, s.tools.ExecuteWrite(p)
	case "edit":
		var p EditParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
		return nil, s.tools.ExecuteEdit(p)
	case "grep":
		var p GrepParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
		return s.tools.ExecuteGrep(p)
	case "glob":
		var p GlobParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
		return s.tools.ExecuteGlob(p)
	case "lsp":
		var p LspParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
		return s.lsp.Handle(p)
	default:
		return nil, fmt.Errorf("unknown tool: %s", req.Tool)
	}
}
```

Add `"fmt"` to the import block.

- [ ] **Step 4: Server.go needs LSPManager stub — add it temporarily**

The server references `LSPManager` which doesn't exist yet. Add a temporary stub at the bottom of `daemon/server.go` to unblock compilation:

```go
// Temporary stub — replaced by lsp.go in Task 6
type LSPManager struct{ notifyFunc func(string, string, json.RawMessage) }
func NewLSPManager(f func(string, string, json.RawMessage)) *LSPManager { return &LSPManager{notifyFunc: f} }
func (m *LSPManager) SetNotifyFunc(f func(string, string, json.RawMessage)) { m.notifyFunc = f }
func (m *LSPManager) Handle(p LspParams) (json.RawMessage, error) { return nil, fmt.Errorf("LSP not yet implemented") }
func (m *LSPManager) Shutdown() {}
```

- [ ] **Step 5: Run server tests**

```bash
cd daemon && go test ./... -run "TestServer" -v
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add daemon/server.go daemon/server_test.go
git commit -m "feat(daemon): server mode with Unix socket and request routing"
```

---

## Task 6: LSP manager

**Files:**
- Create: `daemon/lsp.go`
- Create: `daemon/lsp_test.go`
- Modify: `daemon/server.go` (remove stub)

- [ ] **Step 1: Write lsp_test.go**

Create `daemon/lsp_test.go`:

```go
package main

import (
	"bufio"
	"encoding/json"
	"io"
	"testing"
)

func TestWriteReadLSPFraming(t *testing.T) {
	pr, pw := io.Pipe()
	reader := bufio.NewReader(pr)

	msg := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
	}

	go func() {
		writeLSP(pw, msg)
		pw.Close()
	}()

	raw, err := readLSP(reader)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]interface{}
	json.Unmarshal(raw, &got)
	if got["method"] != "initialize" {
		t.Fatalf("unexpected round-trip: %v", got)
	}
}

func TestLSPManagerUnknownLanguage(t *testing.T) {
	m := NewLSPManager(func(_, _ string, _ json.RawMessage) {})
	_, err := m.Handle(LspParams{Language: "cobol", Method: "initialize", Params: json.RawMessage(`{}`)})
	if err == nil {
		t.Fatal("expected error for unknown language")
	}
}

func TestLSPManagerNoServerInPath(t *testing.T) {
	m := NewLSPManager(func(_, _ string, _ json.RawMessage) {})
	// Go is a known language but gopls won't be in PATH in test env (or might be).
	// Test an unlikely-to-exist server to ensure error path works.
	_, err := m.Handle(LspParams{Language: "rust", Method: "initialize", Params: json.RawMessage(`{}`)})
	// Either errors (rust-analyzer not in PATH) or succeeds (if rust-analyzer is installed) — both are valid.
	// Just verify no panic.
	_ = err
}
```

- [ ] **Step 2: Run — verify framing test fails**

```bash
cd daemon && go test ./... -run "TestWriteReadLSP|TestLSPManagerUnknown" -v 2>&1 | head -10
```

Expected: compile error — `writeLSP` undefined (stub LSPManager in server.go doesn't have it).

- [ ] **Step 3: Write lsp.go**

Create `daemon/lsp.go`:

```go
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var lspCommands = map[string][][]string{
	"go":         {{"gopls"}},
	"python":     {{"pyright-langserver", "--stdio"}, {"pylsp"}, {"jedi-language-server"}},
	"typescript": {{"typescript-language-server", "--stdio"}},
	"javascript": {{"typescript-language-server", "--stdio"}},
	"rust":       {{"rust-analyzer"}},
	"c":          {{"clangd"}},
	"cpp":        {{"clangd"}},
}

type lspError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type lspServer struct {
	language string
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	reader   *bufio.Reader
	mu       sync.Mutex
	pending  map[string]chan json.RawMessage
	nextID   int64
	lastUsed time.Time
	manager  *LSPManager
}

type LSPManager struct {
	servers    map[string]*lspServer
	mu         sync.Mutex
	notifyFunc func(language, method string, params json.RawMessage)
}

func NewLSPManager(notifyFunc func(string, string, json.RawMessage)) *LSPManager {
	m := &LSPManager{
		servers:    make(map[string]*lspServer),
		notifyFunc: notifyFunc,
	}
	go m.idleShutdownLoop()
	return m
}

func (m *LSPManager) SetNotifyFunc(f func(string, string, json.RawMessage)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.notifyFunc = f
}

func (m *LSPManager) Handle(p LspParams) (json.RawMessage, error) {
	server, err := m.getOrStart(p.Language)
	if err != nil {
		return nil, err
	}
	return server.request(p.Method, p.Params)
}

func (m *LSPManager) getOrStart(language string) (*lspServer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.servers[language]; ok {
		return s, nil
	}

	candidates, ok := lspCommands[language]
	if !ok {
		return nil, fmt.Errorf("no LSP server configured for %q", language)
	}

	for _, args := range candidates {
		if _, err := exec.LookPath(args[0]); err != nil {
			continue
		}
		s, err := m.startServer(language, args)
		if err != nil {
			continue
		}
		m.servers[language] = s
		return s, nil
	}

	names := make([]string, len(candidates))
	for i, c := range candidates {
		names[i] = c[0]
	}
	return nil, fmt.Errorf("no LSP server found for %q (tried: %s)", language, strings.Join(names, ", "))
}

func (m *LSPManager) startServer(language string, args []string) (*lspServer, error) {
	c := exec.Command(args[0], args[1:]...)
	stdin, err := c.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := c.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := c.Start(); err != nil {
		return nil, err
	}
	s := &lspServer{
		language: language,
		cmd:      c,
		stdin:    stdin,
		reader:   bufio.NewReader(stdout),
		pending:  make(map[string]chan json.RawMessage),
		lastUsed: time.Now(),
		manager:  m,
	}
	go s.readLoop()
	return s, nil
}

func (m *LSPManager) forwardNotify(language, method string, raw json.RawMessage) {
	m.mu.Lock()
	f := m.notifyFunc
	m.mu.Unlock()
	if f != nil {
		f(language, method, raw)
	}
}

func (m *LSPManager) Shutdown() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.servers {
		s.cmd.Process.Kill()
	}
	m.servers = make(map[string]*lspServer)
}

func (m *LSPManager) idleShutdownLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		m.mu.Lock()
		now := time.Now()
		for lang, s := range m.servers {
			if now.Sub(s.lastUsed) > 10*time.Minute {
				s.cmd.Process.Kill()
				delete(m.servers, lang)
			}
		}
		m.mu.Unlock()
	}
}

func (s *lspServer) request(method string, params json.RawMessage) (json.RawMessage, error) {
	ch := make(chan json.RawMessage, 1)

	s.mu.Lock()
	s.lastUsed = time.Now()
	s.nextID++
	id := fmt.Sprintf("%d", s.nextID)
	s.pending[id] = ch
	s.mu.Unlock()

	msg := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}
	if err := writeLSP(s.stdin, msg); err != nil {
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		return nil, err
	}

	raw, ok := <-ch
	if !ok {
		return nil, fmt.Errorf("LSP server disconnected")
	}

	var resp struct {
		Result json.RawMessage `json:"result"`
		Error  *lspError       `json:"error"`
	}
	json.Unmarshal(raw, &resp)
	if resp.Error != nil {
		return nil, fmt.Errorf("LSP error %d: %s", resp.Error.Code, resp.Error.Message)
	}
	return resp.Result, nil
}

func (s *lspServer) readLoop() {
	for {
		raw, err := readLSP(s.reader)
		if err != nil {
			s.mu.Lock()
			for _, ch := range s.pending {
				close(ch)
			}
			s.mu.Unlock()
			return
		}

		var msg struct {
			ID     interface{} `json:"id"`
			Method string      `json:"method"`
		}
		if json.Unmarshal(raw, &msg) != nil {
			continue
		}

		if msg.Method != "" && msg.ID == nil {
			s.manager.forwardNotify(s.language, msg.Method, raw)
			continue
		}

		if msg.ID != nil {
			id := fmt.Sprintf("%v", msg.ID)
			s.mu.Lock()
			ch, ok := s.pending[id]
			if ok {
				delete(s.pending, id)
			}
			s.mu.Unlock()
			if ok {
				ch <- raw
			}
		}
	}
}

func writeLSP(w io.Writer, v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(data))
	if _, err := io.WriteString(w, header); err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func readLSP(r *bufio.Reader) (json.RawMessage, error) {
	contentLength := 0
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if strings.HasPrefix(line, "Content-Length: ") {
			fmt.Sscanf(line[16:], "%d", &contentLength)
		}
	}
	if contentLength == 0 {
		return nil, fmt.Errorf("missing or zero Content-Length")
	}
	data := make([]byte, contentLength)
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}
	return json.RawMessage(data), nil
}
```

- [ ] **Step 4: Remove the LSP stub from server.go**

In `daemon/server.go`, delete the lines:

```go
// Temporary stub — replaced by lsp.go in Task 6
type LSPManager struct{ notifyFunc func(string, string, json.RawMessage) }
func NewLSPManager(f func(string, string, json.RawMessage)) *LSPManager { return &LSPManager{notifyFunc: f} }
func (m *LSPManager) SetNotifyFunc(f func(string, string, json.RawMessage)) { m.notifyFunc = f }
func (m *LSPManager) Handle(p LspParams) (json.RawMessage, error) { return nil, fmt.Errorf("LSP not yet implemented") }
func (m *LSPManager) Shutdown() {}
```

- [ ] **Step 5: Run all tests**

```bash
cd daemon && go test ./... -v
```

Expected: all tests PASS (LSP framing tests pass, language server tests either pass or error cleanly if server not installed).

- [ ] **Step 6: Commit**

```bash
git add daemon/lsp.go daemon/lsp_test.go daemon/server.go
git commit -m "feat(daemon): LSP manager with language server lifecycle and JSON-RPC proxy"
```

---

## Task 7: Gateway mode

**Files:**
- Create: `daemon/gateway.go`
- Create: `daemon/gateway_test.go`

- [ ] **Step 1: Write gateway tests**

Create `daemon/gateway_test.go`:

```go
package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIsDaemonRunningFalse(t *testing.T) {
	if isDaemonRunning("/tmp/tai-nonexistent-test-socket.sock") {
		t.Fatal("expected false for nonexistent socket")
	}
}

func TestIsDaemonRunningTrue(t *testing.T) {
	dir, _ := os.MkdirTemp("", "tai-gateway-test-*")
	defer os.RemoveAll(dir)
	socketPath := filepath.Join(dir, "daemon.sock")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s := NewServer(socketPath)
	go s.Run(ctx)
	time.Sleep(50 * time.Millisecond)

	if !isDaemonRunning(socketPath) {
		t.Fatal("expected true for running server")
	}
}
```

- [ ] **Step 2: Run — verify they fail**

```bash
cd daemon && go test ./... -run "TestIsDaemon" -v 2>&1 | head -10
```

Expected: compile error — `isDaemonRunning` undefined.

- [ ] **Step 3: Write gateway.go**

Create `daemon/gateway.go`:

```go
package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

func runGateway(socketPath string) error {
	if !isDaemonRunning(socketPath) {
		if err := startDaemon(socketPath); err != nil {
			return fmt.Errorf("failed to start daemon: %w", err)
		}
	}

	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return fmt.Errorf("failed to connect to daemon socket: %w", err)
	}
	defer conn.Close()

	done := make(chan error, 2)
	go func() { _, err := io.Copy(conn, os.Stdin); done <- err }()
	go func() { _, err := io.Copy(os.Stdout, conn); done <- err }()
	<-done
	return nil
}

func isDaemonRunning(socketPath string) bool {
	conn, err := net.DialTimeout("unix", socketPath, time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func startDaemon(socketPath string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}

	logPath := filepath.Join(filepath.Dir(socketPath), "daemon.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}

	cmd := exec.Command(self, "--serve")
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return err
	}
	logFile.Close()
	cmd.Process.Release()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if isDaemonRunning(socketPath) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("daemon did not start within 5 seconds")
}
```

- [ ] **Step 4: Run gateway tests**

```bash
cd daemon && go test ./... -run "TestIsDaemon" -v
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/gateway.go daemon/gateway_test.go
git commit -m "feat(daemon): gateway mode (--connect)"
```

---

## Task 8: Main entry point

**Files:**
- Create: `daemon/main.go`

- [ ] **Step 1: Write main.go**

Create `daemon/main.go`:

```go
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	serveFlag := flag.Bool("serve", false, "Run as background daemon")
	connectFlag := flag.Bool("connect", false, "Connect to daemon and bridge stdio")
	versionFlag := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "could not determine home directory:", err)
		os.Exit(1)
	}
	socketPath := filepath.Join(home, ".tai", "daemon.sock")

	switch {
	case *versionFlag:
		fmt.Println(Version)
	case *serveFlag:
		if err := os.MkdirAll(filepath.Dir(socketPath), 0755); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		s := NewServer(socketPath)
		if err := s.Run(context.Background()); err != nil {
			fmt.Fprintln(os.Stderr, "server error:", err)
			os.Exit(1)
		}
	case *connectFlag:
		if err := runGateway(socketPath); err != nil {
			fmt.Fprintln(os.Stderr, "gateway error:", err)
			os.Exit(1)
		}
	default:
		flag.Usage()
		os.Exit(1)
	}
}
```

- [ ] **Step 2: Build and smoke-test**

```bash
cd daemon && go build -o tai-daemon . && ./tai-daemon --version
```

Expected: prints `1.2.4`.

- [ ] **Step 3: Run full test suite**

```bash
cd daemon && go test ./... -v 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add daemon/main.go && rm daemon/tai-daemon
git commit -m "feat(daemon): main entry point and version flag"
```

---

## Task 9: Cross-compile Makefile

**Files:**
- Create: `daemon/Makefile`
- Create: `daemon/.gitignore`

- [ ] **Step 1: Write Makefile**

Create `daemon/Makefile`:

```makefile
LDFLAGS := -ldflags="-s -w"

all: linux-amd64 linux-arm64 darwin-amd64 darwin-arm64

dist:
	mkdir -p dist

linux-amd64: dist
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o dist/tai-daemon-linux-amd64 .

linux-arm64: dist
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o dist/tai-daemon-linux-arm64 .

darwin-amd64: dist
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o dist/tai-daemon-darwin-amd64 .

darwin-arm64: dist
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o dist/tai-daemon-darwin-arm64 .

test:
	go test ./... -v

clean:
	rm -rf dist/

.PHONY: all linux-amd64 linux-arm64 darwin-amd64 darwin-arm64 test clean dist
```

Create `daemon/.gitignore`:

```
dist/
tai-daemon
```

- [ ] **Step 2: Build linux-amd64 to verify cross-compilation**

```bash
cd daemon && make linux-amd64
```

Expected: `dist/tai-daemon-linux-amd64` created, no errors.

- [ ] **Step 3: Build all targets**

```bash
cd daemon && make all
```

Expected: 4 binaries in `dist/`:
- `tai-daemon-linux-amd64`
- `tai-daemon-linux-arm64`
- `tai-daemon-darwin-amd64`
- `tai-daemon-darwin-arm64`

- [ ] **Step 4: Commit**

```bash
git add daemon/Makefile daemon/.gitignore
git commit -m "feat(daemon): cross-compile Makefile for all platforms"
```

---

## Task 10: RemoteDaemonProxy (TypeScript)

**Files:**
- Create: `electron/services/remoteDaemonProxy.ts`

Before writing, read `electron/services/remoteToolProxy.ts` to confirm the `executeRemoteTool` interface (already reviewed above — it's `executeRemoteTool(tabId: string, toolName: string, input: Record<string, any>): Promise<ToolResult>`).

- [ ] **Step 1: Write remoteDaemonProxy.ts**

Create `electron/services/remoteDaemonProxy.ts`:

```typescript
import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface } from 'readline';
import { randomUUID } from 'crypto';

interface ToolResult {
  output: string;
  isError: boolean;
}

interface DaemonRequest {
  id: string;
  tool: string;
  params: Record<string, unknown>;
}

interface DaemonResponse {
  id?: string;
  type?: string;
  result?: unknown;
  error?: string;
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type DaemonCallbacks = {
  onDisconnect: () => void;
  onLspNotify?: (language: string, method: string, params: unknown) => void;
};

interface DaemonSession {
  proc: ChildProcess;
  rl: Interface;
  pending: Map<string, PendingRequest>;
  pingInterval: ReturnType<typeof setInterval>;
  callbacks: DaemonCallbacks;
}

export class RemoteDaemonProxy {
  private sessions = new Map<string, DaemonSession>();

  async connect(tabId: string, target: string, callbacks: DaemonCallbacks): Promise<void> {
    this.disconnect(tabId);

    const proc = spawn('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      target,
      '~/.tai/tai-daemon', '--connect',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env as Record<string, string>,
    });

    const pending = new Map<string, PendingRequest>();
    const rl = createInterface({ input: proc.stdout! });

    const session: DaemonSession = {
      proc,
      rl,
      pending,
      pingInterval: null as unknown as ReturnType<typeof setInterval>,
      callbacks,
    };
    this.sessions.set(tabId, session);

    await this._waitForReady(session);

    session.pingInterval = setInterval(() => {
      if (!this.isConnected(tabId)) return;
      proc.stdin!.write(JSON.stringify({ type: 'ping' }) + '\n');
    }, 30000);

    proc.on('exit', () => this._handleDisconnect(tabId));
  }

  isConnected(tabId: string): boolean {
    const s = this.sessions.get(tabId);
    return !!s && !s.proc.killed;
  }

  async executeRemoteTool(tabId: string, toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const session = this.sessions.get(tabId);
    if (!session || !this.isConnected(tabId)) {
      return { output: 'Daemon not connected.', isError: true };
    }

    const id = randomUUID();
    const req: DaemonRequest = { id, tool: toolName.toLowerCase(), params: input };

    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          session.pending.delete(id);
          reject(new Error(`Tool ${toolName} timed out`));
        }, (input.timeout as number) ?? 30000);

        session.pending.set(id, { resolve, reject, timeout });
        session.proc.stdin!.write(JSON.stringify(req) + '\n');
      });

      return this._formatResult(toolName, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `Remote execution failed: ${msg}`, isError: true };
    }
  }

  disconnect(tabId: string): void {
    const s = this.sessions.get(tabId);
    if (!s) return;
    clearInterval(s.pingInterval);
    s.rl.close();
    s.proc.kill();
    for (const { reject, timeout } of s.pending.values()) {
      clearTimeout(timeout);
      reject(new Error('Daemon disconnected'));
    }
    this.sessions.delete(tabId);
  }

  destroyAll(): void {
    for (const tabId of this.sessions.keys()) {
      this.disconnect(tabId);
    }
  }

  private _waitForReady(session: DaemonSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Daemon ready timeout after 15s'));
      }, 15000);

      session.rl.on('line', (line) => {
        let msg: DaemonResponse;
        try { msg = JSON.parse(line); } catch { return; }

        if (msg.type === 'ready') {
          clearTimeout(timeout);
          session.rl.removeAllListeners('line');
          session.rl.on('line', (l) => this._handleLine(session, l));
          resolve();
          return;
        }
      });

      session.proc.on('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Daemon exited before ready'));
      });
    });
  }

  private _handleLine(session: DaemonSession, line: string): void {
    let msg: DaemonResponse;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.type === 'pong') return;

    if (msg.type === 'lsp_notify') {
      session.callbacks.onLspNotify?.(
        (msg as any).language,
        (msg as any).method,
        (msg as any).params,
      );
      return;
    }

    if (msg.id) {
      const p = session.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timeout);
      session.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    }
  }

  private _handleDisconnect(tabId: string): void {
    const s = this.sessions.get(tabId);
    if (!s) return;
    clearInterval(s.pingInterval);
    for (const { reject, timeout } of s.pending.values()) {
      clearTimeout(timeout);
      reject(new Error('Daemon disconnected'));
    }
    s.pending.clear();
    this.sessions.delete(tabId);
    s.callbacks.onDisconnect();
  }

  private _formatResult(toolName: string, result: unknown): ToolResult {
    if (result === null || result === undefined) {
      return { output: 'Done.', isError: false };
    }
    const r = result as Record<string, unknown>;
    if (toolName.toLowerCase() === 'bash') {
      return { output: (r.output as string) ?? '', isError: (r.exitCode as number) !== 0 };
    }
    if (toolName.toLowerCase() === 'read') {
      return { output: (r.content as string) ?? '', isError: false };
    }
    if (toolName.toLowerCase() === 'grep') {
      return { output: (r.output as string) ?? 'No matches found.', isError: false };
    }
    if (toolName.toLowerCase() === 'glob') {
      const files = r.files as string[];
      return { output: files.length ? files.join('\n') : 'No files found.', isError: false };
    }
    return { output: JSON.stringify(result), isError: false };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit
```

Expected: no errors related to `remoteDaemonProxy.ts`.

- [ ] **Step 3: Commit**

```bash
git add electron/services/remoteDaemonProxy.ts
git commit -m "feat: RemoteDaemonProxy — JSON protocol over SSH stdio"
```

---

## Task 11: DaemonInstallCard UI

**Files:**
- Create: `src/components/DaemonInstallCard.tsx`

- [ ] **Step 1: Write DaemonInstallCard.tsx**

Create `src/components/DaemonInstallCard.tsx`:

```tsx
import { useState } from 'react';

interface DaemonInstallCardProps {
  target: string;
  isUpdate?: boolean;
  onInstalled: () => void;
  onCancel: () => void;
}

type Status = 'prompt' | 'installing' | 'error';

export function DaemonInstallCard({ target, isUpdate = false, onInstalled, onCancel }: DaemonInstallCardProps) {
  const [status, setStatus] = useState<Status>('prompt');
  const [error, setError] = useState('');

  const handleInstall = async () => {
    setStatus('installing');
    setError('');
    try {
      const result = await window.tai.daemon.install(target);
      if (result.success) {
        onInstalled();
      } else {
        setError(result.error ?? 'Unknown error');
        setStatus('error');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const verb = isUpdate ? 'Update' : 'Install';

  return (
    <div className="daemon-install-card">
      <div className="daemon-install-card__header">
        <span className="daemon-install-card__icon">⚡</span>
        <strong>{verb} TAI Daemon on {target}?</strong>
      </div>
      <p className="daemon-install-card__description">
        Enables full tool support (including Edit) and LSP on this host.
        Installs to <code>~/.tai/tai-daemon</code>.
      </p>
      {status === 'error' && (
        <p className="daemon-install-card__error">
          Install failed: {error}
        </p>
      )}
      <div className="daemon-install-card__actions">
        {status === 'installing' ? (
          <span className="daemon-install-card__installing">Installing…</span>
        ) : (
          <>
            <button className="daemon-install-card__btn daemon-install-card__btn--primary" onClick={handleInstall}>
              {status === 'error' ? 'Retry' : verb}
            </button>
            <button className="daemon-install-card__btn" onClick={onCancel}>
              Not now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS**

Find the main CSS file (likely `src/App.css` or `src/index.css`) and append:

```css
.daemon-install-card {
  background: var(--bg-secondary, #1a1d20);
  border: 1px solid var(--border, #2a2d30);
  border-radius: 8px;
  padding: 12px 16px;
  margin: 8px 12px;
  font-size: 13px;
}

.daemon-install-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.daemon-install-card__icon {
  font-size: 16px;
}

.daemon-install-card__description {
  color: var(--text-secondary, #8a8d90);
  margin: 0 0 10px 0;
  line-height: 1.4;
}

.daemon-install-card__description code {
  background: var(--bg-tertiary, #0c0f11);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: inherit;
}

.daemon-install-card__error {
  color: #e06c75;
  margin: 0 0 10px 0;
  font-size: 12px;
}

.daemon-install-card__installing {
  color: var(--text-secondary, #8a8d90);
  font-style: italic;
}

.daemon-install-card__actions {
  display: flex;
  gap: 8px;
}

.daemon-install-card__btn {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--border, #2a2d30);
  background: transparent;
  color: var(--text, #c0c5cc);
  cursor: pointer;
  font-size: 12px;
}

.daemon-install-card__btn:hover {
  background: var(--bg-tertiary, #0c0f11);
}

.daemon-install-card__btn--primary {
  background: var(--accent, #4d8ef0);
  border-color: var(--accent, #4d8ef0);
  color: white;
}

.daemon-install-card__btn--primary:hover {
  opacity: 0.85;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DaemonInstallCard.tsx
git commit -m "feat: DaemonInstallCard UI component"
```

---

## Task 12: electron/main.ts + preload.ts IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add daemon IPC handlers to electron/main.ts**

In `electron/main.ts`, after the existing imports, add:

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
```

Then, after the existing `ipcMain` handlers (near the end of the file where other `ipcMain.handle` calls live), add:

```typescript
// Daemon IPC handlers
const DAEMON_VERSION = '1.2.4'; // must match Version constant in daemon/protocol.go

ipcMain.handle('tai:daemon:check', async (_event, target: string) => {
  try {
    const { stdout } = await execFileAsync('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      target,
      '~/.tai/tai-daemon --version 2>/dev/null || echo NOT_INSTALLED',
    ], { timeout: 15000 });
    const out = stdout.trim();
    if (out === 'NOT_INSTALLED' || out === '') {
      return { installed: false };
    }
    return { installed: true, version: out, needsUpdate: out !== DAEMON_VERSION };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { installed: false, error: msg };
  }
});

ipcMain.handle('tai:daemon:install', async (_event, target: string) => {
  try {
    // Detect remote OS and arch
    const { stdout: uname } = await execFileAsync('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      target,
      'uname -s && uname -m',
    ], { timeout: 15000 });

    const [osName, archName] = uname.trim().split('\n');
    const binaryName = getDaemonBinaryName(osName.trim(), archName.trim());
    if (!binaryName) {
      return { success: false, error: `Unsupported platform: ${osName} ${archName}` };
    }

    const binaryPath = getDaemonBinaryPath(binaryName);
    if (!binaryPath) {
      return { success: false, error: `Binary not found for ${binaryName}` };
    }

    // Ensure ~/.tai exists on remote
    await execFileAsync('ssh', [
      '-o', 'BatchMode=yes',
      target,
      'mkdir -p ~/.tai',
    ], { timeout: 10000 });

    // Upload binary
    await execFileAsync('scp', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      binaryPath,
      `${target}:~/.tai/tai-daemon`,
    ], { timeout: 60000 });

    // Make executable
    await execFileAsync('ssh', [
      '-o', 'BatchMode=yes',
      target,
      'chmod +x ~/.tai/tai-daemon',
    ], { timeout: 10000 });

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

function getDaemonBinaryName(os: string, arch: string): string | null {
  const osMap: Record<string, string> = { Linux: 'linux', Darwin: 'darwin' };
  const archMap: Record<string, string> = { x86_64: 'amd64', aarch64: 'arm64', arm64: 'arm64' };
  const mappedOs = osMap[os];
  const mappedArch = archMap[arch];
  if (!mappedOs || !mappedArch) return null;
  return `tai-daemon-${mappedOs}-${mappedArch}`;
}

function getDaemonBinaryPath(binaryName: string): string | null {
  const { app } = require('electron');
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'daemon', binaryName)]
    : [
        path.join(__dirname, '..', 'daemon', 'dist', binaryName),
        path.join(__dirname, '..', '..', 'daemon', 'dist', binaryName),
      ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
```

- [ ] **Step 2: Add daemon IPC to preload.ts**

In `electron/preload.ts`, inside the `contextBridge.exposeInMainWorld('tai', { ... })` object, add a `daemon` key after the existing `update` block:

```typescript
  daemon: {
    check: (target: string) => ipcRenderer.invoke('tai:daemon:check', target),
    install: (target: string) => ipcRenderer.invoke('tai:daemon:install', target),
  },
```

- [ ] **Step 3: Add daemon type to window.tai**

Find `src/types.ts` (or wherever `window.tai` types are declared) and add the daemon type. If types are declared inline in preload.ts via `contextBridge`, the TypeScript types flow automatically. If there's a `src/electron.d.ts` or similar ambient type file, add:

```typescript
daemon: {
  check: (target: string) => Promise<{ installed: boolean; version?: string; needsUpdate?: boolean; error?: string }>;
  install: (target: string) => Promise<{ success: boolean; error?: string }>;
};
```

Search for the file with: `grep -r "window.tai" src/ --include="*.d.ts" -l`

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: daemon check + install IPC handlers and preload bridge"
```

---

## Task 13: claude.ts daemon routing + TerminalSession integration

**Files:**
- Modify: `electron/services/claude.ts`
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Add RemoteDaemonProxy to claude.ts**

In `electron/services/claude.ts`, add the import after existing remote imports:

```typescript
import { RemoteDaemonProxy } from './remoteDaemonProxy';
```

After the existing `const toolProxy = new RemoteToolProxy(sshManager);` line, add:

```typescript
const daemonProxy = new RemoteDaemonProxy();
```

Add `daemonEnabled: boolean` to the `ClaudeState` interface:

```typescript
interface ClaudeState {
  process: ChildProcess | null;
  sessionId: string | null;
  buffer: string;
  busy: boolean;
  permMode: string | null;
  remoteTarget: string | null;
  remoteExecMode: 'auto' | 'local';
  daemonEnabled: boolean;
  pendingToolUses: Map<string, { id: string; name: string; input: Record<string, any> }>;
}
```

Update `getState` to include `daemonEnabled: false` in the default state object:

```typescript
state = { process: null, sessionId: null, buffer: '', busy: false, permMode: null, remoteTarget: null, remoteExecMode: 'auto', daemonEnabled: false, pendingToolUses: new Map() };
```

- [ ] **Step 2: Add ai:setDaemonEnabled IPC handler in claude.ts**

Inside `setupClaudeService`, after the existing `ipcMain.handle('ai:setRemoteTarget', ...)` handler, add:

```typescript
  ipcMain.handle('ai:setDaemonEnabled', (_event, key: string, enabled: boolean) => {
    const state = getState(key);
    state.daemonEnabled = enabled;
    if (!enabled) {
      daemonProxy.disconnect(key);
    }
    return true;
  });
```

- [ ] **Step 3: Update handleRemoteToolCalls to prefer daemon**

Replace the entire `handleRemoteToolCalls` function in `electron/services/claude.ts` with:

```typescript
async function handleRemoteToolCalls(
  win: BrowserWindow | null,
  key: string,
  state: ClaudeState,
  toolUses: Array<{ id: string; name: string; input: Record<string, any> }>,
) {
  const useDaemon = state.daemonEnabled && state.remoteTarget;

  if (useDaemon && !daemonProxy.isConnected(key)) {
    try {
      await daemonProxy.connect(key, state.remoteTarget!, {
        onDisconnect: () => {
          const s = claudeStates.get(key);
          if (s) s.daemonEnabled = false;
          safeSend(win, 'ai:message', key, { type: 'daemon:disconnected' });
        },
        onLspNotify: (language, method, params) => {
          safeSend(win, 'ai:message', key, { type: 'lsp_notify', language, method, params });
        },
      });
    } catch (err: any) {
      // daemon connect failed — fall back to agentless
      state.daemonEnabled = false;
      safeSend(win, 'ai:message', key, { type: 'daemon:connect_failed', error: err.message });
    }
  }

  const useAgentless = !state.daemonEnabled || !daemonProxy.isConnected(key);

  if (useAgentless && !sshManager.isConnected(key) && state.remoteTarget) {
    try {
      await sshManager.connect(key, state.remoteTarget);
    } catch (err: any) {
      for (const tool of toolUses) {
        const errorResult = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: tool.id,
              content: `SSH connection failed: ${err.message}. AI commands will run locally.`,
              is_error: true,
            }],
          },
        });
        state.process?.stdin!.write(errorResult + '\n');
      }
      safeSend(win, 'ai:message', key, { type: 'remote:connection_failed', error: err.message });
      return;
    }
  }

  for (const tool of toolUses) {
    const result = useAgentless
      ? await toolProxy.executeRemoteTool(key, tool.name, tool.input)
      : await daemonProxy.executeRemoteTool(key, tool.name, tool.input);

    let output = result.output;
    const MAX_OUTPUT = 200 * 1024;
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + '\n[output truncated at 200KB]';
    }

    const toolResult = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: tool.id,
          content: output,
          is_error: result.isError,
        }],
      },
    });
    state.process?.stdin!.write(toolResult + '\n');
    safeSend(win, 'ai:message', key, {
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: tool.id,
          content: output,
          is_error: result.isError,
        }],
      },
    });
  }
}
```

Also update `destroyAllClaude` (exported function at bottom of claude.ts) to include `daemonProxy.destroyAll()`:

```typescript
export function destroyAllClaude() {
  for (const state of claudeStates.values()) {
    state.process?.kill();
  }
  claudeStates.clear();
  sshManager.destroyAll();
  daemonProxy.destroyAll();
}
```

- [ ] **Step 4: Add setDaemonEnabled to preload.ts**

In `electron/preload.ts`, inside the `ai` object, add:

```typescript
setDaemonEnabled: (key: string, enabled: boolean) => ipcRenderer.invoke('ai:setDaemonEnabled', key, enabled),
```

- [ ] **Step 5: Update TerminalSession.tsx to show install card on SSH detection**

In `src/components/TerminalSession.tsx`, add the import:

```typescript
import { DaemonInstallCard } from './DaemonInstallCard';
```

Add daemon state near the top of the `TerminalSession` function (after existing `useState` declarations):

```typescript
const [daemonState, setDaemonState] = useState<'idle' | 'checking' | 'prompt' | 'update' | 'ready'>('idle');
const daemonCheckedTargetRef = useRef<string | null>(null);
```

Add a `useEffect` that fires when `promptInfo` changes — specifically when `isRemote` becomes true with a new `sshTarget`:

```typescript
useEffect(() => {
  const target = promptInfo?.sshTarget ?? null;
  if (!promptInfo?.isRemote || !target || target === daemonCheckedTargetRef.current) return;

  daemonCheckedTargetRef.current = target;
  setDaemonState('checking');

  window.tai.daemon.check(target).then((result) => {
    if (result.installed && !result.needsUpdate) {
      window.tai.ai.setDaemonEnabled(tabId, true);
      setDaemonState('ready');
    } else if (result.installed && result.needsUpdate) {
      setDaemonState('update');
    } else {
      setDaemonState('prompt');
    }
  }).catch(() => {
    setDaemonState('prompt');
  });
}, [promptInfo?.isRemote, promptInfo?.sshTarget, tabId]);
```

Add a `useEffect` to reset daemon state when SSH session ends:

```typescript
useEffect(() => {
  if (!promptInfo?.isRemote) {
    setDaemonState('idle');
    daemonCheckedTargetRef.current = null;
    window.tai.ai.setDaemonEnabled(tabId, false);
  }
}, [promptInfo?.isRemote, tabId]);
```

Add handlers for the install card:

```typescript
const handleDaemonInstalled = useCallback(() => {
  window.tai.ai.setDaemonEnabled(tabId, true);
  setDaemonState('ready');
}, [tabId]);

const handleDaemonCancel = useCallback(() => {
  setDaemonState('idle');
}, []);
```

In the JSX, add the install card. Find the `{passwordPrompt && ...}` conditional render block and add the daemon card immediately after it (before the `TerminalInput`):

```tsx
{(daemonState === 'prompt' || daemonState === 'update') && promptInfo?.sshTarget && (
  <DaemonInstallCard
    target={promptInfo.sshTarget}
    isUpdate={daemonState === 'update'}
    onInstalled={handleDaemonInstalled}
    onCancel={handleDaemonCancel}
  />
)}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add electron/services/claude.ts electron/services/remoteDaemonProxy.ts electron/preload.ts src/components/TerminalSession.tsx
git commit -m "feat: wire daemon proxy into claude.ts and TerminalSession"
```

---

## Task 14: Bundle daemon binaries + end-to-end test

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Build all daemon binaries**

```bash
cd daemon && make all
```

Expected: `dist/` contains 4 binaries.

- [ ] **Step 2: Add extraResources to package.json**

In `package.json`, find the `build` section (used by electron-builder). Add `extraResources`:

```json
"build": {
  ...
  "extraResources": [
    {
      "from": "daemon/dist/",
      "to": "daemon/",
      "filter": ["tai-daemon-*"]
    }
  ],
  ...
}
```

If `extraResources` already exists, merge the entry into the array.

- [ ] **Step 3: Start dev server**

```bash
npm run dev
```

Expected: TAI starts without errors.

- [ ] **Step 4: Test install flow**

In the running TAI app:
1. Open a terminal tab
2. SSH into a remote host: `ssh user@somehost`
3. Verify: install card appears after SSH prompt is detected
4. Click "Not now" — verify card dismisses, AI still works (agentless fallback)
5. SSH in again — verify card appears again (it checks per SSH session)
6. Click "Install" — verify installation completes and card disappears

If you don't have a remote host, test with `ssh localhost` (if configured).

- [ ] **Step 5: Test daemon tool execution**

After daemon is installed:
1. Ask the AI to edit a file: `edit /tmp/test.txt, change "hello" to "world"`
2. Verify: Edit tool runs successfully (not the "tool not available" error from agentless)
3. Ask: `what files are in /tmp?` — verify Glob works

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "feat: bundle daemon binaries in Electron app resources"
```

---

## Summary

| Task | Component | Key Output |
|------|-----------|-----------|
| 1 | Go module + protocol | `daemon/go.mod`, `daemon/protocol.go` |
| 2 | Bash + Read | `daemon/tools.go` (partial), tests passing |
| 3 | Write + Edit | `daemon/tools.go` complete for file ops |
| 4 | Grep + Glob | `daemon/tools.go` complete |
| 5 | Server | `daemon/server.go`, Unix socket + routing |
| 6 | LSP manager | `daemon/lsp.go`, language server lifecycle |
| 7 | Gateway | `daemon/gateway.go`, `--connect` mode |
| 8 | Main | `daemon/main.go`, buildable binary |
| 9 | Build | `daemon/Makefile`, 4 platform binaries |
| 10 | TS Proxy | `electron/services/remoteDaemonProxy.ts` |
| 11 | Install UI | `src/components/DaemonInstallCard.tsx` |
| 12 | IPC handlers | `electron/main.ts`, `preload.ts` |
| 13 | Integration | `claude.ts`, `TerminalSession.tsx` wired |
| 14 | Bundle + E2E | `package.json`, manual smoke test |
