@echo off
REM Surface bench runner: needs agent-webmcp on PATH and Chrome.
set PATH=C:\Program Files\Go\bin;%PATH%
python "%~dp0run.py"
