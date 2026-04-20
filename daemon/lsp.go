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
