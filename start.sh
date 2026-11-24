#!/bin/sh
# Start Clip Crew on macOS or Linux. Uses the virtual environment if there is one.
cd "$(dirname "$0")" || exit 1
if [ -x .venv/bin/python ]; then exec .venv/bin/python server.py; else exec python3 server.py; fi
