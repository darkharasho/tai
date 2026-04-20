package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
		if ctx.Err() == context.DeadlineExceeded {
			return BashResult{}, fmt.Errorf("command timed out after %v", timeout)
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
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

// ExecuteWrite writes content to a file, creating parent directories as needed.
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

// ExecuteEdit replaces old_string with new_string in a file.
// Returns error if old_string is not found or is ambiguous (appears > 1 time).
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

// keep filepath import used until needed
var _ = filepath.Join
