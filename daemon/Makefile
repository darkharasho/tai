.PHONY: all linux-amd64 linux-arm64 darwin-amd64 darwin-arm64 clean

VERSION := $(shell cat ../package.json | grep '"version"' | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

all: linux-amd64 linux-arm64 darwin-amd64 darwin-arm64

linux-amd64:
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/tai-daemon-linux-amd64 .

linux-arm64:
	GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/tai-daemon-linux-arm64 .

darwin-amd64:
	GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/tai-daemon-darwin-amd64 .

darwin-arm64:
	GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/tai-daemon-darwin-arm64 .

clean:
	rm -rf dist/
