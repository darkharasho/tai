package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

func defaultSocketPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp/tai-daemon.sock"
	}
	return filepath.Join(home, ".tai", "daemon.sock")
}

func main() {
	serve := flag.Bool("serve", false, "run daemon server")
	connect := flag.Bool("connect", false, "run gateway (stdio bridge)")
	version := flag.Bool("version", false, "print version")
	socketPath := flag.String("socket", defaultSocketPath(), "unix socket path")
	flag.Parse()

	switch {
	case *version:
		fmt.Println(Version)

	case *serve:
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
		defer stop()
		// Ensure socket directory exists
		if err := os.MkdirAll(filepath.Dir(*socketPath), 0700); err != nil {
			fmt.Fprintf(os.Stderr, "tai-daemon: mkdir: %v\n", err)
			os.Exit(1)
		}
		srv := NewServer(*socketPath)
		if err := srv.Run(ctx); err != nil {
			fmt.Fprintf(os.Stderr, "tai-daemon: %v\n", err)
			os.Exit(1)
		}

	case *connect:
		if err := runGateway(*socketPath); err != nil {
			fmt.Fprintf(os.Stderr, "tai-daemon: %v\n", err)
			os.Exit(1)
		}

	default:
		fmt.Fprintln(os.Stderr, "usage: tai-daemon [--serve | --connect | --version]")
		os.Exit(2)
	}
}
