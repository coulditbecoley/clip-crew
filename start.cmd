@echo off
rem Start Clip Crew on Windows. Uses the virtual environment if there is one.
cd /d "%~dp0"
start "" http://127.0.0.1:5177
if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe server.py) else (python server.py)
