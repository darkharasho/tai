package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"time"
)

func isDaemonRunning(socketPath string) bool {
	conn, err := net.DialTimeout("unix", socketPath, 500*time.Millisecond)
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

	cmd := exec.Command(self, "--serve")
	cmd.SysProcAttr = newSysProcAttr()
	if err := cmd.Start(); err != nil {
		return err
	}

	// Wait up to 5 seconds for socket to appear
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if isDaemonRunning(socketPath) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("daemon did not start within 5 seconds")
}

func runGateway(socketPath string) error {
	if !isDaemonRunning(socketPath) {
		if err := startDaemon(socketPath); err != nil {
			return fmt.Errorf("failed to start daemon: %w", err)
		}
	}

	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return fmt.Errorf("failed to connect to daemon: %w", err)
	}
	defer conn.Close()

	// Bridge stdin → socket
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(conn, os.Stdin)
		done <- struct{}{}
	}()
	// Bridge socket → stdout
	go func() {
		io.Copy(os.Stdout, conn)
		done <- struct{}{}
	}()

	<-done
	return nil
}
