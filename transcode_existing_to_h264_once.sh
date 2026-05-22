#!/usr/bin/env bash
set -euo pipefail

# One-time helper: generate H.264 sidecars for existing non-H.264 videos.
# Usage:
#   ./transcode_existing_to_h264_once.sh [VIDEO_DIR]
# Default VIDEO_DIR is ./timelapse

VIDEO_DIR="${1:-./timelapse}"

if [[ ! -d "$VIDEO_DIR" ]]; then
  echo "Video directory not found: $VIDEO_DIR" >&2
  exit 1
fi

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  RUN_LOCAL=1
else
  RUN_LOCAL=0
fi

if [[ "$RUN_LOCAL" -eq 1 ]]; then
  shopt -s nullglob
  echo "Using local ffmpeg/ffprobe. Scanning $VIDEO_DIR for videos to convert..."

  converted=0
  skipped=0
  failed=0

  for f in "$VIDEO_DIR"/*; do
    [[ -f "$f" ]] || continue

    ext="${f##*.}"
    ext="${ext,,}"
    case "$ext" in
      mp4|mov|mkv|webm|avi|ogg) ;;
      *) continue ;;
    esac

    if [[ "$f" == *_h264.mp4 ]]; then
      ((skipped+=1))
      continue
    fi

    codec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$f" 2>/dev/null || true)"
    if [[ "$codec" == "h264" ]]; then
      echo "SKIP (already h264): $f"
      ((skipped+=1))
      continue
    fi

    out="${f%.*}_h264.mp4"
    if [[ -f "$out" ]]; then
      echo "SKIP (sidecar exists): $out"
      ((skipped+=1))
      continue
    fi

    echo "CONVERT: $f -> $out"
    if ffmpeg -y -i "$f" \
      -c:v libx264 -preset veryfast -crf 21 \
      -pix_fmt yuv420p -movflags +faststart \
      -an "$out"; then
      ((converted+=1))
    else
      echo "FAILED: $f" >&2
      rm -f -- "$out"
      ((failed+=1))
    fi
  done

  echo "Done. Converted=$converted Skipped=$skipped Failed=$failed"
  [[ "$failed" -eq 0 ]] || exit 2
  exit 0
fi

echo "Local ffmpeg/ffprobe not found. Using timelapse container tools."
docker compose exec -T timelapse sh -lc '
set -eu
VIDEO_DIR="/app/'"${VIDEO_DIR#./}"'"
converted=0
skipped=0
failed=0
for f in "$VIDEO_DIR"/*; do
  [ -f "$f" ] || continue
  ext="$(printf "%s" "${f##*.}" | tr "[:upper:]" "[:lower:]")"
  case "$ext" in
    mp4|mov|mkv|webm|avi|ogg) ;;
    *) continue ;;
  esac
  case "$f" in
    *_h264.mp4) skipped=$((skipped+1)); continue ;;
  esac
  codec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$f" 2>/dev/null || true)"
  if [ "$codec" = "h264" ]; then
    echo "SKIP (already h264): $f"
    skipped=$((skipped+1))
    continue
  fi
  out="${f%.*}_h264.mp4"
  if [ -f "$out" ]; then
    echo "SKIP (sidecar exists): $out"
    skipped=$((skipped+1))
    continue
  fi
  echo "CONVERT: $f -> $out"
  if ffmpeg -y -i "$f" -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -movflags +faststart -an "$out"; then
    converted=$((converted+1))
  else
    echo "FAILED: $f" >&2
    rm -f -- "$out"
    failed=$((failed+1))
  fi
done
echo "Done. Converted=$converted Skipped=$skipped Failed=$failed"
[ "$failed" -eq 0 ] || exit 2
'
