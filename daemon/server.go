package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
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
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	w.conn.Write(append(data, '\n')) //nolint:errcheck — write errors close the scanner loop naturally
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
			w.writeJSON(Response{Error: fmt.Sprintf("invalid json: %v", err)})
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

// Temporary stub — replaced by lsp.go in Task 6
type LSPManager struct{ notifyFunc func(string, string, json.RawMessage) }

func NewLSPManager(f func(string, string, json.RawMessage)) *LSPManager {
	return &LSPManager{notifyFunc: f}
}
func (m *LSPManager) SetNotifyFunc(f func(string, string, json.RawMessage)) { m.notifyFunc = f }
func (m *LSPManager) Handle(p LspParams) (json.RawMessage, error) {
	return nil, fmt.Errorf("LSP not yet implemented")
}
func (m *LSPManager) Shutdown() {}
