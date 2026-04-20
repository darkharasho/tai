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
