<p align="center">
  <img src="logo.png" alt="Project Logo" width="200"/>
</p>

# Bambu Timelapse Downloader

A Python tool to automate downloading, upscaling, and making streamable timelapse videos from a Bambu 3D printer via FTPS.

## Run As A Docker Compose Stack

This repo now supports running the full workflow as a Docker Compose stack (downloader + optional web UI).

Services in `docker-compose.yml`:

- `timelapse`: downloads and converts timelapse videos.
- `nginx`: simple static file browser/player (port `8090`).
- `youtube`: richer UI clone with metadata editing, AVI conversion tools, and filtering/pagination (port `8091`).

Most setups will want `timelapse` plus **one** UI service (`nginx` or `youtube`), not both.

### Quick Start

1. Copy `config.json_template` to `config.json` and set printer credentials.
2. Start downloader + YouTube-style UI:
  ```bash
  docker compose up -d --build timelapse youtube
  ```
3. Or start downloader + nginx UI:
  ```bash
  docker compose up -d --build timelapse nginx
  ```

### Access URLs

- YouTube-style UI: `http://<host>:8091`
- nginx UI: `http://<host>:8090`
- Timelapse watcher status endpoint: `http://<host>:8083/status`

### Useful Compose Commands

```bash
# Check service status
docker compose ps

# Follow logs for a specific service
docker compose logs -f timelapse
docker compose logs -f youtube
docker compose logs -f nginx

# Stop everything
docker compose down
```

---

## Features

- **Secure Download:** Downloads timelapse videos from your Bambu printer using FTPS.
- **Flexible Selection:** Download the latest or all available timelapse videos.
- **Watch Mode:** Continuously checks for new videos every 60 seconds and downloads them automatically.
- **Automatic Conversion:** By default, upscales videos to 1080p and makes them streamable using ffmpeg with NVIDIA GPU acceleration, or CPU-only mode with `--no-gpu`.
- **Clean-Up:** Deletes remote files after download and deletes original files after successful conversion.
- **Configurable:** Printer credentials are stored in a config file, not in the script.
- **Organized Output:** Stores videos in a `timelapse` subfolder by default.

---

## Requirements

- Python 3.7+
- tqdm
- ffmpeg (with NVIDIA GPU support and `hevc_nvenc`) or just CPU (see `--no-gpu` option)
- Bambu printer with FTP access

---

## Installation

Install Python dependencies with pip:
```bash
pip install -r requirements.txt
```

You also need ffmpeg with NVIDIA GPU support (see [ffmpeg docs](https://ffmpeg.org/)).

---

## Setup

1. **Clone this repository.**

2. **Create a config file:**
   - Copy `config.json_template` to `config.json` and fill in your printer details:
     ```json
     {
       "printer_ip": "192.168.1.123",
       "access_code": "YOUR_ACCESS_CODE"
     }
     ```

3. **Ensure ffmpeg is installed with NVIDIA GPU support.**

---

## Usage

```bash
python get_timelapse.py [options]
```

### Options

- `--last`  
  Download only the latest timelapse video (default if no option given).

- `--all`  
  Download all available timelapse videos.

- `--out <folder>`  
  Output directory to save downloaded videos (default: ./timelapse).

- `--do-not-delete`  
  Do not delete remote file(s) after download (ignored in --watch mode).

- `--watch`  
  Continuously check for new timelapse files every 60 seconds and download them.

- `--no-make-streamable`  
  Do **not** convert videos to streamable 1080p using ffmpeg (by default, conversion is ON).

- `--no-gpu`  
  Force CPU-only processing for video conversion (useful if you do not have an NVIDIA GPU).

- `--codec <h264|hevc>`  
  Target codec for streamable conversion (default: `h264` for broad browser compatibility).

- `--status-port <port>`  
  Expose an HTTP status endpoint on the given port. Useful with `--watch`
  for external monitoring (Uptime Kuma, Prometheus blackbox, etc.).
  Returns JSON `{state, last_check, last_success, last_error, current_file}`
  where `state` is `starting | idle | working | error`. HTTP status is
  **200** normally and **503** when the last cycle errored, so a plain
  status-code monitor is sufficient (no JSON parsing required). Off by
  default.

### Example Commands

Download the latest timelapse and make it streamable (default):
```bash
python get_timelapse.py
```

Download all timelapses and keep the originals on the printer:
```bash
python get_timelapse.py --all --do_not_delete
```

Download to a specific folder, convert to streamable, and run in watch mode:
```bash
python get_timelapse.py --all --watch --out /path/to/folder
```

Download without conversion:
```bash
python get_timelapse.py --no-make-streamable
```

Download and convert using CPU only (no NVIDIA GPU required):
```bash
python get_timelapse.py --no-gpu
```

Download and convert to HEVC instead of default H.264:
```bash
python get_timelapse.py --codec hevc
```

---

## ffmpeg Conversion

By default, after download, each video is converted to a browser-friendly streamable 1080p MP4 (`h264`). If you use `--codec hevc`, conversion will use HEVC instead.

**Default H.264 CPU example (`--no-gpu`):**
```bash
ffmpeg -y -i input.mp4 -vf scale=1920:1080 -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -movflags +faststart output_streamable.mp4
```

```bash
ffmpeg -y -hwaccel cuda -i input.mp4 -vf scale=1920:1080 -c:v hevc_nvenc -preset p7 -tune hq -b:v 15M -tag:v hvc1 -video_track_timescale 90000 output_streamable.mp4
```

**CPU-only example (with --no-gpu):**
```bash
ffmpeg -y -i input.mp4 -vf scale=1920:1080 -c:v libx265 -preset slow -b:v 15M -tag:v hvc1 -video_track_timescale 90000 output_streamable.mp4
```

The original file is deleted after successful conversion.

---

## Telegram Upload (Optional)

If you want each streamable video to be uploaded automatically to a Telegram channel:

1. Create a Telegram bot and get the bot token.
2. Add the bot to your channel/group and get the channel username (e.g. @your_channel) or chat ID.
3. Add these fields to your `config.json`:
   ```json
   {
     "telegram_bot_token": "YOUR_BOT_TOKEN",
     "telegram_channel_id": "@your_channel_or_chat_id"
   }
   ```

### How to Get Your Telegram Group Chat ID

1. **Invite [@ShowJsonBot](https://t.me/ShowJsonBot) to your group.**
2. **Send any message in the group.**
3. **The bot will reply with the full JSON, including the chat ID.**
4. **Use the value of `"id"` as your `telegram_channel_id` in `config.json`.**

If both fields are present, every converted (streamable) video will be uploaded to your Telegram channel automatically after processing.

If not set, Telegram upload is skipped.

---

## One-Time Existing Library H.264 Prep

To pre-generate H.264 sidecars for existing non-H.264 videos (so playback is instant with no first-play transcode delay):

```bash
./transcode_existing_to_h264_once.sh ./timelapse
```

This script skips videos that are already H.264 and skips sidecars that already exist (`*_h264.mp4`).

---

## Web UI AVI Catch-Up Conversion

If some files remain in `.avi` format, open the web UI at `/avi` to manage conversion interactively:

- View all `.avi` files currently present in the video directory.
- Click **Convert** on an individual file.
- Click **Convert All** to queue all remaining `.avi` files.
- Watch per-file queue/conversion progress live from the page.

---

## Notes

- Ensure your printer’s FTP server is accessible and credentials are correct (set in `config.json`).
- ffmpeg with NVIDIA GPU support is required for conversion (see [ffmpeg docs](https://ffmpeg.org/)).
- The script creates a `timelapse` folder for output by default.

---

## Support & Donations

If you found this project useful, consider supporting my work with a small donation: [ko-fi.com/yurymonzon](https://ko-fi.com/yurymonzon)
Your support is greatly appreciated!

---

## Attribution

Inspired by [SuiDog’s post on the Bambu Lab Forum](https://forum.bambulab.com/t/connecting-to-the-p1s-ftp-with-python/115179).

---

## License

MIT License

---