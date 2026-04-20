package main

import (
	"bufio"
	"encoding/json"
	"io"
	"testing"
)

func TestWriteReadLSPFraming(t *testing.T) {
	pr, pw := io.Pipe()
	reader := bufio.NewReader(pr)

	msg := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
	}

	go func() {
		writeLSP(pw, msg)
		pw.Close()
	}()

	raw, err := readLSP(reader)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]interface{}
	json.Unmarshal(raw, &got)
	if got["method"] != "initialize" {
		t.Fatalf("unexpected round-trip: %v", got)
	}
}

func TestLSPManagerUnknownLanguage(t *testing.T) {
	m := NewLSPManager(func(_, _ string, _ json.RawMessage) {})
	_, err := m.Handle(LspParams{Language: "cobol", Method: "initialize", Params: json.RawMessage(`{}`)})
	if err == nil {
		t.Fatal("expected error for unknown language")
	}
}
