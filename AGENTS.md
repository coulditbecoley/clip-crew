# Clip Crew: notes for coding agents

Clip Crew is a local web app. A person pastes a stream link or drops a recording, and it cuts captioned vertical Shorts into a library. There is no build step, no database and no API key.

## Set it up for the user

Do these in order and stop at the first failure.

1. Check Python is 3.10 or newer: `python --version` (use `python3` on macOS and Linux).
2. Check ffmpeg: `ffmpeg -version`. If it is missing, install it and tell the user what you ran:
   - Windows: `winget install Gyan.FFmpeg` (open a new terminal afterwards so PATH updates)
   - macOS: `brew install ffmpeg`
   - Debian or Ubuntu: `sudo apt install ffmpeg`
3. Create a virtual environment in the repo and install the two dependencies:
   - `python -m venv .venv`
   - Windows: `.venv\Scripts\python -m pip install -r requirements.txt`
   - macOS and Linux: `.venv/bin/python -m pip install -r requirements.txt`
4. Run both self-checks with the venv's Python. Each must print `selftest ok`:
   - `server.py --selftest`
   - `clip.py --selftest`
5. Start the server with the venv's Python as a background process: `server.py`. It prints the address, http://127.0.0.1:5177 by default. Set the `PORT` environment variable if that port is taken.
6. Open the address in the user's browser and tell them how to start it again later.

The first clip job downloads the Whisper `small` speech model (about 500 MB). Tell the user so the wait is expected.

## How it fits together

- `server.py`: standard library HTTP server, JSON API, one worker thread that runs jobs in order. It shells out to ffmpeg, ffprobe and yt-dlp.
- `clip.py`: the moment finder and caption writer, also usable alone from the command line. `server.py` imports from it.
- `static/`: the whole front end. `index.html` (markup and app logic), `style.css`, `scene.js` (the WebGL sunset and the drawn skyline), and self-hosted fonts. `Bungee-Regular.ttf` is the font burned into captions.
- `library/`: created at run time, one folder per stream with its clips and a `job.json`. It is git-ignored. Never commit it.

## Rules when changing it

- Keep it dependency-light: standard library on the server, no framework and no build step on the front end.
- Run both self-checks after any change to `server.py` or `clip.py`.
- Hook titles use the `claude` command when it is on PATH and fall back to the first spoken line. Keep that fallback working.
- The server listens on 127.0.0.1 only. Do not bind it to other interfaces; it has no login.
- Do not add game publisher logos or artwork. Keep the footer disclaimer.
