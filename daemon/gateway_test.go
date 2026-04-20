package main

import (
	"net"
	"path/filepath"
	"testing"
)

func TestIsDaemonRunningFalse(t *testing.T) {
	dir := t.TempDir()
	socketPath := filepath.Join(dir, "daemon.sock")
	if isDaemonRunning(socketPath) {
		t.Fatal("expected false for non-existent socket")
	}
}

func TestIsDaemonRunningTrue(t *testing.T) {
	dir := t.TempDir()
	socketPath := filepath.Join(dir, "daemon.sock")

	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	if !isDaemonRunning(socketPath) {
		t.Fatal("expected true when socket is listening")
	}
}
