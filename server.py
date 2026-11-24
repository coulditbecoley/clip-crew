"""Clip Crew: paste a stream, get captioned vertical Shorts in a library.

    python server.py            ->  http://127.0.0.1:5177

Needs ffmpeg on PATH and `pip install -r requirements.txt`.
Hook titles are written by the `claude` CLI when it is installed; without it the
first spoken line becomes the title.
"""
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).parent
STATIC, LIB = ROOT / "static", ROOT / "library"
UPLOADS = LIB / "_uploads"
PORT = int(os.environ.get("PORT", 5177))

from clip import caption, pick_peaks, window  # the command line version shares the moment finder

JOBS, LOCK, QUEUE = {}, threading.RLock(), queue.Queue()
PLATFORMS = ("youtube", "tiktok", "reels")
ID = re.compile(r"^[a-f0-9]{12}$")
MEDIA = re.compile(r"^clip_\d\d\.(mp4|jpg)$")
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
         ".mp4": "video/mp4", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2",
         ".png": "image/png", ".ico": "image/x-icon"}


def save(job):
    with LOCK:
        d = LIB / job["id"]
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "job.tmp"
        tmp.write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
        tmp.replace(d / "job.json")


def update(job, **kw):
    with LOCK:
        job.update(kw)
    save(job)


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, stdin=subprocess.DEVNULL, **kw)


# ---------- pipeline ----------

def download(job, url, dest):
    update(job, stage="download", progress=0)
    js = ["--js-runtimes", "node"] if shutil.which("node") else []  # YouTube needs a JS runtime for all formats
    proc = subprocess.Popen(
        [sys.executable, "-m", "yt_dlp", *js, "--newline", "--no-playlist", "-f", "bv*[height<=1080][dynamic_range=SDR]+ba/bv*[height<=1080]+ba/b",  # HDR versions come out washed
         "--merge-output-format", "mp4", "--print", "before_dl:TITLE %(title)s", "--no-simulate",
         "-o", str(dest), url],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout:
        if line.startswith("TITLE "):
            update(job, name=line[6:].strip()[:120])
        m = re.search(r"\[download\]\s+([\d.]+)%", line)
        if m:
            with LOCK:
                job["progress"] = float(m.group(1)) / 100
    if proc.wait() or not dest.exists():
        raise RuntimeError("Could not download that link. Check it is a public Twitch, Kick or YouTube video, "
                           "or download the recording yourself and drop the file in.")


def duration(video):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
              capture_output=True, text=True).stdout.strip()
    return float(out)


def is_hdr(video):
    out = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer",
               "-of", "csv=p=0", video], capture_output=True, text=True).stdout
    return "smpte2084" in out or "arib-std-b67" in out


def listen(job, video):
    """Loudness for every second, streamed into the job so the page can draw it live."""
    total = duration(video)
    update(job, stage="listen", progress=0, duration=total, levels=[])
    proc = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-vn", "-af",
         "aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,"
         "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, text=True)
    for line in proc.stdout:
        m = re.search(r"RMS_level=(\S+)", line)
        if not m:
            continue
        try:
            v = float(m.group(1))
        except ValueError:
            v = -90.0
        v = -90.0 if v != v else max(v, -90.0)
        with LOCK:
            job["levels"].append(round(v, 1))
            job["progress"] = min(1, len(job["levels"]) / max(total, 1))
    if proc.wait():
        raise RuntimeError("ffmpeg could not read the audio in that recording.")
    if not job["levels"]:
        raise RuntimeError("That recording has no audio to listen to.")


_model = None


def whisper():
    """Load Whisper once. GPU when it works, CPU otherwise. False when it is not installed."""
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel
            import numpy as np
        except ImportError:
            _model = False
            return _model
        try:
            m = WhisperModel("small", device="cuda", compute_type="float16")
            list(m.transcribe(np.zeros(16000, dtype="float32"))[0])  # fails here if CUDA libs are missing
            _model = m
        except Exception:
            _model = WhisperModel("small", device="cpu", compute_type="int8")
    return _model


_encoder = None


def encoder():
    """NVIDIA's encoder when the PC has one (several times faster), x264 otherwise."""
    global _encoder
    if _encoder is None:
        try:
            run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=s=256x256:d=0.2", "-c:v", "h264_nvenc",
                 "-f", "null", "-"], capture_output=True, timeout=20)
            _encoder = ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-pix_fmt", "yuv420p"]
        except Exception:
            _encoder = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
    return _encoder


# Captions use the Bungee font that ships in static/, so they look the same on every machine
CAPTION_STYLE = ("Fontname=Bungee,Fontsize=21,PrimaryColour=&H00FFFFFF,OutlineColour=&H00400A2E,"
                 "BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=70")


def around(levels, t, r=2):
    """Average loudness in the few seconds around t."""
    part = levels[max(0, t - r):t + r + 1]
    return sum(part) / len(part)


def quiet(levels, t, r=3):
    """Nudge a cut onto the quietest nearby second, so a clip does not start or end mid-sentence."""
    lo, hi = max(0, t - r), min(len(levels) - 1, t + r)
    return min(range(lo, hi + 1), key=lambda i: levels[i])


def cut(job, video, n, peak):
    levels, d = job["levels"], LIB / job["id"]
    start, name = quiet(levels, window(peak, job["settings"]["seconds"], len(levels))), f"clip_{n:02}"
    secs = max(5, quiet(levels, start + job["settings"]["seconds"]) + 1 - start)
    lo, hi = sorted(levels)[len(levels) // 2], max(around(levels, p) for p in job["peaks"])
    clip = {"n": n, "file": f"{name}.mp4", "thumb": f"{name}.jpg", "start": start, "end": start + secs,
            "heat": max(0, min(100, round(100 * (around(levels, peak) - lo) / (hi - lo)))) if hi > lo else 50,
            "transcript": "", "title": "", "ready": False, "posted": {p: False for p in PLATFORMS}}
    with LOCK:
        job["clips"].append(clip)
    text = ""
    if whisper():
        wav = d / f"{name}.wav"
        run(["ffmpeg", "-y", "-v", "error", "-ss", start, "-t", secs, "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav])
        text = caption(wav, d / f"{name}.srt", whisper())
        wav.unlink(missing_ok=True)
    vf = "crop='min(iw,ih*9/16)':ih,scale=1080:1920,setsar=1"
    if job.get("hdr"):  # HDR game captures look grey unless they are mapped down to normal video
        vf += ",zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
    if text:  # relative srt name plus cwd, so Windows paths never reach the filter
        vf += f",subtitles={name}.srt:fontsdir=../../static:force_style='{CAPTION_STYLE}'"
    run(["ffmpeg", "-y", "-v", "error", "-ss", start, "-t", secs, "-i", video, "-vf", vf, *encoder(),
         "-c:a", "aac", "-movflags", "+faststart", f"{name}.mp4"], cwd=d)
    # Poster frame from the loudest second, where something is actually happening
    run(["ffmpeg", "-y", "-v", "error", "-ss", max(0, min(peak - start, secs - 1)), "-i", f"{name}.mp4", "-frames:v", "1",
         "-vf", "scale=540:-2", "-q:v", "3", f"{name}.jpg"], cwd=d)
    with LOCK:
        clip.update(transcript=text, ready=True, title=fallback_title(text, n))
    save(job)


def fallback_title(text, n):
    first = re.split(r"(?<=[.!?])\s", text.strip())[0][:58].strip(" ,.")
    return first or f"Moment {n}"


def write_titles(job):
    """One call to the Claude CLI for every clip. Any failure keeps the fallback titles."""
    exe = shutil.which("claude")
    # A clip with only a word or two of speech gets no invented title
    clips = [c for c in job["clips"] if len(c["transcript"].split()) >= 6]
    if not exe or not clips:
        return
    update(job, stage="titles", progress=0)
    prompt = ("You write hook titles for vertical gaming Shorts cut from a GTA 6 stream. For each clip below, "
              "write one title under 60 characters that says what happens and makes a stranger tap. No hashtags, "
              "no emoji, no quotes, no story spoilers, no dashes. Reply with only a JSON array of strings, one per "
              "clip, in order.\n\n" + "\n".join(f"Clip {i + 1}: {c['transcript'][:600]}" for i, c in enumerate(clips)))
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDECODE", "CLAUDE_CODE"))}
    try:
        out = subprocess.run([exe, "-p", "--model", "haiku"], input=prompt, capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=90, env=env, cwd=str(LIB)).stdout
        titles = json.loads(re.search(r"\[.*\]", out, re.S).group(0))
        if len(titles) != len(clips):
            return
        with LOCK:
            for c, t in zip(clips, titles):
                if isinstance(t, str) and t.strip():
                    c["title"] = t.strip()[:80]
    except Exception:
        pass  # fallback titles stay


def process(job):
    d = LIB / job["id"]
    video = Path(job["path"]) if job.get("path") else d / "source.mp4"
    if job.get("url"):
        download(job, job["url"], video)
    job["hdr"] = is_hdr(video)
    listen(job, video)
    secs = job["settings"]["seconds"]
    if len(job["levels"]) < secs:
        raise RuntimeError(f"That recording is only {len(job['levels'])} seconds. Pick a shorter clip length.")
    peaks = pick_peaks(job["levels"], job["settings"]["clips"], gap=secs * 2)
    median = sorted(job["levels"])[len(job["levels"]) // 2]
    peaks = [p for p in peaks if around(job["levels"], p) - median >= 3]  # a moment has to stand out from the room
    if not peaks:
        raise RuntimeError("Nothing in this recording stands out. It is silent, or one flat volume all the way through.")
    update(job, stage="cut", progress=0, peaks=peaks)
    for n, peak in enumerate(peaks, 1):
        cut(job, video, n, peak)
        with LOCK:
            job["progress"] = n / len(peaks)
    write_titles(job)
    if job.get("url"):  # the clips are the product; the multi GB download is not
        video.unlink(missing_ok=True)
    update(job, status="done", stage="done", progress=1)


def worker():
    while True:
        job = QUEUE.get()
        if job["id"] not in JOBS:  # deleted while queued
            continue
        update(job, status="running")
        try:
            process(job)
        except Exception as e:
            msg = str(e) if isinstance(e, RuntimeError) else f"Something broke while cutting: {e}"
            update(job, status="error", error=msg[:400])
        finally:
            up = job.get("upload")
            if up:
                Path(up).unlink(missing_ok=True)


def new_job(body):
    src = (body.get("source") or "").strip().strip('"')
    job = {"id": uuid.uuid4().hex[:12], "created": time.time(), "status": "queued", "stage": "queued",
           "progress": 0, "duration": 0, "levels": [], "peaks": [], "clips": [], "error": "",
           "settings": {"clips": max(1, min(12, int(body.get("clips", 5)))),
                        "seconds": max(10, min(90, int(body.get("seconds", 45))))}}
    if body.get("upload"):
        up = UPLOADS / Path(body["upload"]).name
        if not up.is_file():
            raise ValueError("That upload did not arrive. Try dropping the file again.")
        job.update(path=str(up), upload=str(up), name=Path(body.get("name") or "Recording").stem)
    elif re.match(r"https?://", src):
        job.update(url=src, name=urlparse(src).netloc.replace("www.", ""))
    elif src and Path(src).is_file():
        job.update(path=str(Path(src).resolve()), name=Path(src).stem)
    else:
        raise ValueError("Paste a stream link, a file path on this PC, or drop a recording.")
    with LOCK:
        JOBS[job["id"]] = job
    save(job)
    QUEUE.put(job)
    return job


def public(job, since=None):
    with LOCK:
        j = {k: v for k, v in job.items() if k not in ("path", "upload", "levels")}
        j["level_count"] = len(job["levels"])
        if since is not None:
            j["levels"] = job["levels"][since:]
        j["clips"] = [dict(c) for c in job["clips"]]
        return j


def safe_name(title, n):
    return (re.sub(r'[\\/:*?"<>|]+', "", title).strip()[:70] or f"clip {n}") + ".mp4"


# ---------- http ----------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def fail(self, msg, code=400):
        self.send_json({"error": msg}, code)

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def send_file(self, path, download_as=None):
        if not path.is_file():
            return self.fail("Not found", 404)
        size, start, end = path.stat().st_size, 0, None
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m and (m.group(1) or m.group(2)):  # video seeking needs ranges
            if m.group(1):
                start, end = int(m.group(1)), int(m.group(2)) if m.group(2) else size - 1
            else:
                start, end = max(0, size - int(m.group(2))), size - 1
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                return self.end_headers()
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            end = size - 1
            self.send_response(200)
        self.send_header("Content-Type", TYPES.get(path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", end - start + 1)
        self.send_header("Accept-Ranges", "bytes")
        if path.suffix in (".html", ".css", ".js"):
            self.send_header("Cache-Control", "no-store")
        if download_as:
            ascii_name = download_as.encode("ascii", "ignore").decode() or "clip.mp4"
            self.send_header("Content-Disposition", f'attachment; filename="{ascii_name}"')
        self.end_headers()
        if self.command == "HEAD":
            return
        with path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 18, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (ConnectionError, OSError):
                    return  # the browser stopped the video
                left -= len(chunk)

    def job(self, jid):
        return JOBS.get(jid) if ID.match(jid or "") else None

    def do_GET(self):
        u = urlparse(self.path)
        parts = [unquote(p) for p in u.path.strip("/").split("/") if p]
        q = parse_qs(u.query)
        if not parts:
            return self.send_file(STATIC / "index.html")
        if parts[0] == "static" and len(parts) == 2 and re.match(r"^[\w.-]+$", parts[1]):
            return self.send_file(STATIC / parts[1])
        if parts[:2] == ["api", "jobs"] and len(parts) == 2:
            with LOCK:
                jobs = sorted(JOBS.values(), key=lambda j: -j["created"])
            return self.send_json([public(j) for j in jobs])
        if parts[:2] == ["api", "jobs"] and len(parts) >= 3:
            job = self.job(parts[2])
            if not job:
                return self.fail("That stream is not in the library.", 404)
            if len(parts) == 3:
                since = int(q["since"][0]) if "since" in q else None
                return self.send_json(public(job, since))
            if parts[3] == "zip":
                return self.send_zip(job)
        if parts[0] == "media" and len(parts) == 3 and MEDIA.match(parts[2]):
            job = self.job(parts[1])
            if job:
                name = None
                if "dl" in q:
                    c = next((c for c in job["clips"] if c["file"] == parts[2]), None)
                    name = safe_name(c["title"], c["n"]) if c else parts[2]
                return self.send_file(LIB / job["id"] / parts[2], name)
        self.fail("Not found", 404)

    do_HEAD = do_GET

    def send_zip(self, job):
        d = LIB / job["id"]
        z = d / "clips.zip"
        with LOCK:
            clips = [dict(c) for c in job["clips"] if c["ready"]]
        with zipfile.ZipFile(z, "w", zipfile.ZIP_STORED) as f:
            for c in clips:
                f.write(d / c["file"], f"{c['n']:02} {safe_name(c['title'], c['n'])}")
            f.writestr("titles.txt", "\n".join(f"{c['n']:02}  {c['title']}" for c in clips))
        self.send_file(z, safe_name(job["name"], 0).replace(".mp4", " clips.zip"))

    def do_POST(self):
        u = urlparse(self.path)
        try:
            if u.path == "/api/upload":
                ext = Path(parse_qs(u.query).get("name", ["x.mp4"])[0]).suffix.lower()
                if ext not in (".mp4", ".mkv", ".mov", ".webm", ".flv", ".ts", ".m4v"):
                    return self.fail("That file type is not a video recording.")
                UPLOADS.mkdir(parents=True, exist_ok=True)
                dest, left = UPLOADS / (uuid.uuid4().hex + ext), int(self.headers.get("Content-Length") or 0)
                with dest.open("wb") as f:
                    while left > 0:
                        chunk = self.rfile.read(min(1 << 20, left))
                        if not chunk:
                            break
                        f.write(chunk)
                        left -= len(chunk)
                if left:
                    dest.unlink(missing_ok=True)
                    return self.fail("The upload was cut off. Try again.")
                return self.send_json({"upload": dest.name})
            if u.path == "/api/jobs":
                return self.send_json(public(new_job(self.body_json())), 201)
        except ValueError as e:
            return self.fail(str(e))
        self.fail("Not found", 404)

    def do_PATCH(self):
        m = re.match(r"^/api/jobs/([a-f0-9]{12})/clips/(\d+)$", urlparse(self.path).path)
        job = self.job(m.group(1)) if m else None
        body = self.body_json()
        if not job:
            return self.fail("Not found", 404)
        with LOCK:
            clip = next((c for c in job["clips"] if c["n"] == int(m.group(2))), None)
            if not clip:
                return self.fail("Not found", 404)
            if isinstance(body.get("title"), str):
                clip["title"] = body["title"].strip()[:80] or clip["title"]
            for p, v in (body.get("posted") or {}).items():
                if p in PLATFORMS:
                    clip["posted"][p] = bool(v)
        save(job)
        self.send_json(public(job))

    def do_DELETE(self):
        m = re.match(r"^/api/jobs/([a-f0-9]{12})$", urlparse(self.path).path)
        job = self.job(m.group(1)) if m else None
        if not job:
            return self.fail("Not found", 404)
        if job["status"] == "running":
            return self.fail("Wait for this stream to finish cutting first.", 409)
        with LOCK:
            JOBS.pop(job["id"], None)
        shutil.rmtree(LIB / job["id"], ignore_errors=True)
        self.send_json({"ok": True})


def selftest():
    flat = [-40.0] * 200
    flat[98:103] = [-12.0] * 5
    flat[95], flat[130] = -70.0, -65.0
    assert quiet(flat, 97) == 95 and quiet(flat, 128) == 130 and quiet(flat, 0) == 0
    assert round(around(flat, 100)) == -12 and around(flat, 50) == -40.0
    assert fallback_title("No way. The car sank!", 1) == "No way" and fallback_title("", 4) == "Moment 4"
    assert safe_name('a/b:c?"', 2) == "abc.mp4" and safe_name("", 2) == "clip 2.mp4"
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if sys.platform == "win32":  # rendering stays out of the way of everything else; ffmpeg inherits this
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    missing = [t for t in ("ffmpeg", "ffprobe") if not shutil.which(t)]
    if missing:
        sys.exit(f"{' and '.join(missing)} not found. Install ffmpeg (https://ffmpeg.org/download.html) and put it on PATH.")
    for mod, what in (("faster_whisper", "clips will have no captions or titles"), ("yt_dlp", "stream links will not download")):
        try:
            __import__(mod)
        except ImportError:
            print(f"Note: {mod} is not installed, so {what}. Fix: pip install -r requirements.txt")
    LIB.mkdir(exist_ok=True)
    for f in LIB.glob("*/job.json"):
        try:
            job = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if job["status"] in ("queued", "running"):
            job.update(status="error", error="The server stopped while this stream was cutting. Run it again.")
        JOBS[job["id"]] = job
    threading.Thread(target=worker, daemon=True).start()
    # On Windows the default lets two servers share one port and silently split the requests
    ThreadingHTTPServer.allow_reuse_address = sys.platform != "win32"
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        sys.exit(f"Port {PORT} is busy. Clip Crew is probably already running at http://127.0.0.1:{PORT}")
    print(f"Clip Crew is running at http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
