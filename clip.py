"""Clip Crew on the command line: one stream recording in, captioned vertical Shorts out.

    python clip.py stream.mp4                 # 5 clips, 45 seconds each, into ./clips
    python clip.py <stream URL> --clips 8     # downloads with yt-dlp first
    python clip.py --selftest                 # checks the moment finder

Needs ffmpeg on PATH. Captions need `pip install faster-whisper` (skipped if missing).
URLs need `pip install yt-dlp`. Only clip streamers who said yes.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


def loudness(video):
    """Loudness in dB for every second of the recording (ffmpeg does the maths)."""
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", video, "-vn", "-af",
               "aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,"
               "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
               "-f", "null", "-"], capture_output=True, text=True).stdout
    levels = []
    for x in re.findall(r"RMS_level=(\S+)", out):
        try:
            levels.append(max(float(x), -90.0))
        except ValueError:  # "-inf" on some builds reads fine, "nan" does not
            levels.append(-90.0)
    return [-90.0 if v != v else v for v in levels]


def pick_peaks(levels, n, gap, smooth=5):
    """The n loudest moments, at least `gap` seconds apart.

    ponytail: loudness only. A streamer yelling is a decent signal and needs no
    chat log. Add chat spikes and transcript keywords when clips feel random.
    """
    half = smooth // 2
    avg = [sum(levels[max(0, i - half):i + half + 1]) / len(levels[max(0, i - half):i + half + 1])
           for i in range(len(levels))]  # one loud second is a click, five is a moment
    picks = []
    for i in sorted(range(len(avg)), key=lambda i: -avg[i]):
        if all(abs(i - p) >= gap for p in picks):
            picks.append(i)
        if len(picks) == n:
            break
    return sorted(picks)


def window(peak, seconds, total):
    """Start the clip before the peak so the build-up is in it."""
    return max(0, min(peak - seconds * 2 // 3, total - seconds))


def srt_time(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def caption(wav, srt, model):
    """Whisper the clip and write 3 word captions. Returns the transcript."""
    # vad_filter: without it Whisper invents lines like "Thanks for watching!" over music
    # Read the 16 kHz mono wav ourselves: faster-whisper's own file reader breaks on some PyAV versions
    import wave
    import numpy as np
    with wave.open(str(wav), "rb") as f:
        assert (f.getframerate(), f.getnchannels(), f.getsampwidth()) == (16000, 1, 2), "expected 16 kHz mono 16-bit wav"
        audio = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    segments, _ = model.transcribe(audio, word_timestamps=True, vad_filter=True)
    words = [w for s in segments for w in s.words]
    lines = [words[i:i + 3] for i in range(0, len(words), 3)]
    srt.write_text("".join(
        f"{n}\n{srt_time(g[0].start)} --> {srt_time(g[-1].end)}\n{''.join(w.word for w in g).strip()}\n\n"
        for n, g in enumerate(lines, 1)), encoding="utf-8")
    return "".join(w.word for w in words).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?", help="a recording on disk, or a stream URL")
    ap.add_argument("--clips", type=int, default=5)
    ap.add_argument("--seconds", type=int, default=45)
    ap.add_argument("--out", default="clips")
    ap.add_argument("--model", default="small", help="Whisper model: tiny, base, small, medium")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        quiet = [-40.0] * 600
        for t in (100, 300, 500):
            quiet[t - 2:t + 3] = [-10.0] * 5
        quiet[305] = -5.0  # louder, but too close to 300 to be its own clip
        assert pick_peaks(quiet, 3, 60) in ([100, 300, 500], [100, 301, 500], [100, 302, 500]), pick_peaks(quiet, 3, 60)
        assert window(10, 45, 600) == 0 and window(590, 45, 600) == 555 and window(300, 45, 600) == 270
        assert srt_time(3661.5) == "01:01:01,500"
        print("selftest ok")
        return
    if not a.video:
        ap.error("give me a recording or a URL")

    if sys.platform == "win32":  # stay out of the way while rendering; ffmpeg inherits this
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    video = a.video
    if re.match(r"https?://", video):
        print("Downloading the stream...")
        run([sys.executable, "-m", "yt_dlp", "-f", "bv*[height<=1080][dynamic_range=SDR]+ba/bv*[height<=1080]+ba/b", "--merge-output-format", "mp4",
             "-o", out / "source.%(ext)s", video])
        video = out / "source.mp4"
    video = Path(video).resolve()

    print("Listening for the loud moments...")
    levels = loudness(video)
    if len(levels) < a.seconds:
        sys.exit(f"The recording is only {len(levels)} seconds. Use a shorter --seconds.")
    peaks = pick_peaks(levels, a.clips, gap=a.seconds * 2)

    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(a.model, device="cpu", compute_type="int8")
    except ImportError:
        model = None
        print("faster-whisper is not installed, so clips will have no captions.")

    report = []
    for n, peak in enumerate(peaks, 1):
        start, name = window(peak, a.seconds, len(levels)), f"clip_{n:02}"
        print(f"Cutting {name}: {start // 3600}:{start // 60 % 60:02}:{start % 60:02}")
        vf, text = "crop='min(iw,ih*9/16)':ih,scale=1080:1920", ""
        if model:
            wav = out / f"{name}.wav"
            run(["ffmpeg", "-y", "-v", "error", "-ss", start, "-t", a.seconds, "-i", video,
                 "-vn", "-ac", "1", "-ar", "16000", wav])
            text = caption(wav, out / f"{name}.srt", model)
            wav.unlink()
            if text:  # relative srt name plus cwd=out, so Windows paths never reach the filter
                vf += f",subtitles={name}.srt:force_style='Fontsize=15,Bold=1,Outline=2,Alignment=2,MarginV=70'"
        run(["ffmpeg", "-y", "-v", "error", "-ss", start, "-t", a.seconds, "-i", video, "-vf", vf,
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", f"{name}.mp4"], cwd=out)
        report.append({"file": f"{name}.mp4", "start_seconds": start, "end_seconds": start + a.seconds,
                       "loudness_db": round(levels[peak], 1), "transcript": text, "title": ""})

    (out / "clips.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDone. {len(report)} clips in {out.resolve()}")
    print("Next: have your AI agent read clips.json, drop the boring ones and write a hook title for each.")


if __name__ == "__main__":
    main()
