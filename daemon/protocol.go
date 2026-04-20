package main

import "encoding/json"

const Version = "1.2.4"

type Request struct {
	ID     string          `json:"id,omitempty"`
	Type   string          `json:"type,omitempty"`
	Tool   string          `json:"tool,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	ID     string      `json:"id,omitempty"`
	Type   string      `json:"type,omitempty"`
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

type ReadyMessage struct {
	Type         string   `json:"type"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

type BashParams struct {
	Command string `json:"command"`
	Cwd     string `json:"cwd"`
	Timeout int    `json:"timeout"`
}

type BashResult struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
}

type ReadParams struct {
	Path   string `json:"path"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
}

type ReadResult struct {
	Content string `json:"content"`
}

type WriteParams struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type EditParams struct {
	Path      string `json:"path"`
	OldString string `json:"old_string"`
	NewString string `json:"new_string"`
}

type GrepParams struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path"`
	Glob    string `json:"glob,omitempty"`
}

type GrepResult struct {
	Output string `json:"output"`
}

type GlobParams struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path,omitempty"`
}

type GlobResult struct {
	Files []string `json:"files"`
}

type LspParams struct {
	Language string          `json:"language"`
	Method   string          `json:"method"`
	Params   json.RawMessage `json:"params"`
}
