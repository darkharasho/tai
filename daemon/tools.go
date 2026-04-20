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

// Stubs for tools implemented in Tasks 3 and 4
func (t *ToolExecutor) ExecuteWrite(p WriteParams) error { return fmt.Errorf("not implemented") }
func (t *ToolExecutor) ExecuteEdit(p EditParams) error   { return fmt.Errorf("not implemented") }
func (t *ToolExecutor) ExecuteGrep(p GrepParams) (GrepResult, error) {
	return GrepResult{}, fmt.Errorf("not implemented")
}
func (t *ToolExecutor) ExecuteGlob(p GlobParams) (GlobResult, error) {
	return GlobResult{}, fmt.Errorf("not implemented")
}

// keep doublestar import used until Task 4
var _ = doublestar.Glob

// keep filepath import used until needed
var _ = filepath.Join
