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
