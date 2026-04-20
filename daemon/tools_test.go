package main

import (
	"os"
	"strings"
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
