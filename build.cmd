@echo off
set PATH=C:\Program Files\Go\bin;%PATH%
go vet ./...
go build -trimpath -ldflags="-s -w" -buildvcs=false -o agent-webmcp.exe .
