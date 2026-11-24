# Clip Crew

Paste a GTA 6 stream, get captioned vertical Shorts in a library, ready to download and post. Runs on your own PC. No accounts, no keys, nothing leaves your machine except the stream download.

## Run it

You need Python 3.10 or newer and [ffmpeg](https://ffmpeg.org/download.html) on your PATH.

```
pip install -r requirements.txt
python server.py
```

Then open http://127.0.0.1:5177. On Windows you can double-click `start.cmd` instead.

## What it does

1. Takes a Twitch, Kick or YouTube link, a file path on your PC, or a dropped recording.
2. Listens to the whole stream and draws its loudness live.
3. Flags the loudest moments, cuts each one to 1080x1920 on a quiet beat, and burns in captions.
4. Writes a hook title for each clip.
5. Files everything in the library: play, rename, download one or all, and tick where you posted.

Clips are saved in `library/`.

## Good to know

- An NVIDIA card is used for encoding and transcription when one is found. Everything falls back to the CPU.
- Hook titles come from the `claude` command line tool if it is installed. Without it, the first spoken line becomes the title.
- Moments are picked by loudness, so a stream with a talking streamer works best. Silent gameplay gives clips with no captions.
- The crop is the centre of the frame. A facecam in a corner will be cut off.
- For YouTube links, having Node.js installed helps the downloader reach every format.
- Change the port with the `PORT` environment variable.

## Command line

The same clipper without the web page:

```
python clip.py <file or link> --clips 5 --seconds 45
```

## Check it after changes

```
python server.py --selftest
python clip.py --selftest
```

## Play fair

Only clip streamers who said yes. Read the game publisher's video policy before you monetize.

Unofficial fan project. Not affiliated with Rockstar Games or Take-Two.

MIT licensed. Fonts in `static/` are under the SIL Open Font License.
