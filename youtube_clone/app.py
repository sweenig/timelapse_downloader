from flask import Flask, render_template, jsonify, request, send_file, Response, abort
import os
import json
import mimetypes
import re
import subprocess
import threading
import time
import uuid
import tempfile
from datetime import datetime
from urllib.parse import quote, unquote
from urllib.request import urlopen

VIDEO_DIR = os.environ.get('VIDEO_DIR', '/videos')
DATA_DIR = os.environ.get('DATA_DIR', '/data')
META_FILE = os.path.join(DATA_DIR, 'metadata.json')
THUMB_DIR = os.path.join(DATA_DIR, 'thumbnails')
RANGE_CHUNK_SIZE = 1024 * 1024
TIMELAPSE_STATUS_URL = os.environ.get('TIMELAPSE_STATUS_URL', 'http://timelapse:8083/status')

app = Flask(__name__, static_folder='static', template_folder='templates')

# Conversion queue and status tracking for .avi -> mp4 jobs
convert_queue = []
convert_status = {}  # name -> {status: 'queued'|'running'|'success'|'error', percent:0, message:''}
queue_lock = threading.Lock()

# Merge job tracking
merge_jobs = {}  # job_id -> {status, percent, message, output_name}
merge_jobs_lock = threading.Lock()


def list_avi_files():
    try:
        files = [
            f for f in os.listdir(VIDEO_DIR)
            if os.path.isfile(os.path.join(VIDEO_DIR, f)) and f.lower().endswith('.avi')
        ]
    except Exception:
        files = []
    return sorted(files)


def list_videos():
    try:
        files = [f for f in os.listdir(VIDEO_DIR) if os.path.isfile(os.path.join(VIDEO_DIR, f))]
    except Exception:
        files = []
    try:
        with open(META_FILE, 'r') as mf:
            metas = json.load(mf)
    except Exception:
        metas = {}

    file_set = set(files)
    videos = []
    for f in files:
        if not f.lower().endswith(('.mp4', '.webm', '.ogg', '.mov', '.mkv')):
            continue

        # Hide generated H.264 sidecars when the primary source file exists.
        if f.lower().endswith('_h264.mp4'):
            original_name = f[:-9] + '.mp4'
            if original_name in file_set:
                continue

        path = os.path.join(VIDEO_DIR, f)
        try:
            size = os.path.getsize(path)
        except Exception:
            size = 0

        meta = {'name': f, 'size': size}
        m = re.match(r'^video_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})(?:_(.*))?$', os.path.splitext(f)[0])
        if m:
            date_part = m.group(1)
            time_part = m.group(2).replace('-', ':')
            rest = m.group(3) or ''
            try:
                dt = datetime.fromisoformat(f"{date_part}T{time_part}")
                iso = dt.isoformat()
                ts = int(dt.timestamp())
            except Exception:
                iso = None
                ts = None
            meta.update({'timestamp': iso, 'ts': ts, 'date': date_part, 'time': time_part, 'flags': rest})
            meta['streamable'] = 'streamable' in rest.lower() or 'streamable' in f.lower()
        else:
            meta.update({'timestamp': None, 'ts': None, 'date': None, 'time': None, 'flags': ''})
            meta['streamable'] = 'streamable' in f.lower()

        saved = metas.get(f, {})
        if saved:
            meta.update(saved)
        meta['thumbnail'] = '/thumbnail/' + quote(f)
        videos.append(meta)

    videos.sort(key=lambda x: x['name'])
    return videos


def enqueue_conversion(name):
    safe_name = os.path.basename(name)
    if not safe_name.lower().endswith('.avi'):
        return {'ok': False, 'error': 'only .avi files are supported'}

    inpath = os.path.join(VIDEO_DIR, safe_name)
    if not os.path.exists(inpath):
        return {'ok': False, 'error': 'file not found'}

    with queue_lock:
        current = convert_status.get(safe_name, {}).get('status')
        if safe_name in convert_queue:
            return {'ok': True, 'queued': False, 'status': 'queued'}
        if current == 'running':
            return {'ok': True, 'queued': False, 'status': 'running'}
        convert_queue.append(safe_name)
        convert_status.setdefault(safe_name, {})
        convert_status[safe_name].update({'status': 'queued', 'percent': 0, 'message': ''})

    return {'ok': True, 'queued': True, 'status': 'queued'}


def conversion_worker():
    while True:
        name = None
        with queue_lock:
            if convert_queue:
                name = convert_queue.pop(0)
        if not name:
            time.sleep(0.5)
            continue
        # start conversion
        convert_status.setdefault(name, {})
        convert_status[name].update({'status': 'running', 'percent': 0, 'message': ''})
        inpath = os.path.join(VIDEO_DIR, name)
        base, _ = os.path.splitext(name)
        outname = f"{base}_streamable.mp4"
        outpath = os.path.join(VIDEO_DIR, outname)
        # get duration via ffprobe
        try:
            probe = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', inpath], capture_output=True, text=True)
            duration = float(probe.stdout.strip()) if probe.returncode == 0 and probe.stdout.strip() else None
        except Exception:
            duration = None
        cmd = [
            'ffmpeg', '-y',
            '-progress', 'pipe:1', '-nostats',
            '-i', inpath,
            '-vf','scale=1920:1080',
            '-c:v','libx265','-preset','slow','-b:v','15M','-tag:v','hvc1','-video_track_timescale','90000',
            outpath
        ]
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            # parse progress lines from stdout
            while True:
                line = proc.stdout.readline()
                if line == '' and proc.poll() is not None:
                    break
                if not line:
                    time.sleep(0.05)
                    continue
                line = line.strip()
                if '=' in line:
                    k,v = line.split('=',1)
                    if k == 'out_time_ms' and v.isdigit() and duration:
                        out_seconds = int(v) / 1_000_000.0
                        pct = min(100, int((out_seconds / duration) * 100)) if duration and duration > 0 else 0
                        convert_status[name]['percent'] = pct
                    if k == 'progress' and v == 'end':
                        convert_status[name]['percent'] = 100
            ret = proc.wait()
            if ret == 0 and os.path.exists(outpath):
                # remove original avi
                try:
                    os.remove(inpath)
                except Exception:
                    pass
                convert_status[name].update({'status':'success','percent':100,'message':'Converted'})
            else:
                stderr = proc.stderr.read() if proc.stderr else ''
                lines = [line.strip() for line in stderr.splitlines() if line.strip()]
                tail = ' | '.join(lines[-3:]) if lines else ''
                convert_status[name].update({'status': 'error', 'message': f'ffmpeg failed: {ret} {tail[:500]}'.strip()})
        except Exception as e:
            convert_status[name].update({'status':'error','message': str(e)})


# start background worker thread
worker_thread = threading.Thread(target=conversion_worker, daemon=True)
worker_thread.start()


@app.route('/')
def index():
    return render_template('index.html', videos=list_videos())


@app.route('/watch')
def watch_page():
    return render_template('watch.html')


@app.route('/avi')
def avi_page():
    return render_template('avi.html')


@app.route('/api/videos')
def api_videos():
    return jsonify(list_videos())


def serve_video_path(path):
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    file_size = os.path.getsize(path)
    range_header = request.headers.get('Range', None)
    if range_header:
        m = re.search(r'bytes=(\d+)-(\d*)', range_header)
        if m:
            start = int(m.group(1))
            end = m.group(2)
            end = int(end) if end else min(start + RANGE_CHUNK_SIZE - 1, file_size - 1)
            end = min(end, start + RANGE_CHUNK_SIZE - 1)
            if end >= file_size:
                end = file_size - 1
            if start >= file_size:
                rv = Response(status=416)
                rv.headers['Content-Range'] = f'bytes */{file_size}'
                return rv
            length = end - start + 1
            with open(path, 'rb') as f:
                f.seek(start)
                data = f.read(length)
            rv = Response(data, 206, mimetype=mime)
            rv.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
            rv.headers['Accept-Ranges'] = 'bytes'
            rv.headers['Content-Length'] = str(length)
            return rv
    return send_file(path, mimetype=mime, as_attachment=False)


def ensure_h264_compat(input_path):
    # Already a generated compatibility sidecar.
    if input_path.lower().endswith('_h264.mp4'):
        return input_path

    base, ext = os.path.splitext(input_path)
    if ext.lower() != '.mp4':
        return input_path

    # If the source is already H.264, no sidecar is needed.
    probe_cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        input_path,
    ]
    probe = subprocess.run(probe_cmd, capture_output=True, text=True)
    if probe.returncode == 0 and probe.stdout.strip() == 'h264':
        return input_path

    output_path = base + '_h264.mp4'
    if os.path.exists(output_path):
        return output_path

    cmd = [
        'ffmpeg', '-y', '-i', input_path,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(output_path):
        abort(500, description='Failed to generate H.264 compatibility file')
    return output_path


@app.route('/api/avi-count')
def api_avi_count():
    count = len(list_avi_files())
    return jsonify({'count': count})


@app.route('/api/downloader-status')
def api_downloader_status():
    fallback = {
        'state': 'unavailable',
        'last_check': None,
        'last_success': None,
        'last_error': None,
        'current_file': None,
    }
    try:
        with urlopen(TIMELAPSE_STATUS_URL, timeout=2.5) as response:
            payload = json.load(response)
        if not isinstance(payload, dict):
            return jsonify(fallback)
        return jsonify({
            'state': payload.get('state') or 'unknown',
            'last_check': payload.get('last_check'),
            'last_success': payload.get('last_success'),
            'last_error': payload.get('last_error'),
            'current_file': payload.get('current_file'),
        })
    except Exception:
        return jsonify(fallback)


@app.route('/video-h264/<path:filename>')
def video_h264(filename):
    safe_name = os.path.basename(unquote(filename))
    input_path = os.path.join(VIDEO_DIR, safe_name)
    if not os.path.exists(input_path):
        abort(404)
    compat_path = ensure_h264_compat(input_path)
    return serve_video_path(compat_path)


@app.route('/api/avi-files')
def api_avi_files():
    avi_files = list_avi_files()
    with queue_lock:
        queue_snapshot = list(convert_queue)
        status_snapshot = {k: dict(v) for k, v in convert_status.items()}

    items = []
    for name in avi_files:
        status = status_snapshot.get(name, {}).get('status', 'idle')
        percent = int(status_snapshot.get(name, {}).get('percent', 0) or 0)
        message = status_snapshot.get(name, {}).get('message', '')
        queue_position = None
        if name in queue_snapshot:
            status = 'queued'
            queue_position = queue_snapshot.index(name) + 1
        path = os.path.join(VIDEO_DIR, name)
        try:
            size = os.path.getsize(path)
        except Exception:
            size = 0
        items.append({
            'name': name,
            'size': size,
            'status': status,
            'percent': percent,
            'message': message,
            'queue_position': queue_position,
        })

    return jsonify({'items': items})


@app.route('/api/avi-convert', methods=['POST'])
def api_avi_convert():
    data = request.get_json() or {}
    name = data.get('name', '')
    result = enqueue_conversion(name)
    status_code = 200 if result.get('ok') else 400
    return jsonify(result), status_code


@app.route('/api/avi-convert-all', methods=['POST'])
def api_avi_convert_all():
    avi_files = list_avi_files()
    queued = 0
    skipped = 0
    for name in avi_files:
        result = enqueue_conversion(name)
        if result.get('ok') and result.get('queued'):
            queued += 1
        else:
            skipped += 1
    return jsonify({'ok': True, 'queued': queued, 'skipped': skipped, 'total': len(avi_files)})


@app.route('/thumbnail/<path:filename>')
def thumbnail(filename):
    safe_name = os.path.basename(unquote(filename))
    path = os.path.join(VIDEO_DIR, safe_name)
    if not os.path.exists(path):
        abort(404)
    os.makedirs(THUMB_DIR, exist_ok=True)
    thumb_path = os.path.join(THUMB_DIR, f"{safe_name}.webp")
    if not os.path.exists(thumb_path):
        cmd = [
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-sseof', '-1', '-i', path,
            '-vframes', '1', '-q:v', '2', '-y', thumb_path
        ]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0 or not os.path.exists(thumb_path):
            fallback_cmd = [
                'ffmpeg', '-hide_banner', '-loglevel', 'error',
                '-i', path,
                '-vframes', '1', '-q:v', '2', '-y', thumb_path
            ]
            fallback = subprocess.run(fallback_cmd, capture_output=True)
            if fallback.returncode != 0 or not os.path.exists(thumb_path):
                abort(500)
    return send_file(thumb_path, mimetype='image/webp')


@app.route('/api/meta', methods=['GET'])
def get_meta():
    try:
        with open(META_FILE, 'r') as mf:
            metas = json.load(mf)
    except Exception:
        metas = {}
    return jsonify(metas)


@app.route('/api/meta', methods=['POST'])
def save_meta():
    data = request.get_json() or {}
    filename = data.get('name')
    if not filename:
        return jsonify({'error': 'missing name'}), 400
    entry = {
        'friendly_name': data.get('friendly_name') or '',
        'description': data.get('description') or '',
        'maker_link': data.get('maker_link') or ''
    }
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        try:
            with open(META_FILE, 'r') as mf:
                metas = json.load(mf)
        except Exception:
            metas = {}
        metas[filename] = entry
        with open(META_FILE, 'w') as mf:
            json.dump(metas, mf, indent=2)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    return jsonify({'ok': True, 'entry': entry})


@app.route('/video/<path:filename>')
def video(filename):
    safe_name = os.path.basename(unquote(filename))
    path = os.path.join(VIDEO_DIR, safe_name)
    if not os.path.exists(path):
        abort(404)
    return serve_video_path(path)


# ── Management page ─────────────────────────────────────────────────────────

@app.route('/manage')
def manage():
    videos = list_videos()
    return render_template('manage.html', videos=videos)


def _get_codec(path):
    """Return lowercase codec name for first video stream, or empty string."""
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=codec_name',
         '-of', 'default=noprint_wrappers=1:nokey=1', path],
        capture_output=True, text=True
    )
    return result.stdout.strip().lower() if result.returncode == 0 else ''


def _resolve_h264_source(name):
    """
    Return the path to a guaranteed-H.264 source for *name*.
    Priority: original if already H.264  →  existing _h264 sidecar  →
              call ensure_h264_compat() to build one.
    Returns None if file not found.
    """
    safe = os.path.basename(name)
    path = os.path.join(VIDEO_DIR, safe)
    if not os.path.exists(path):
        return None
    if _get_codec(path) == 'h264':
        return path
    sidecar = os.path.splitext(path)[0] + '_h264.mp4'
    if os.path.exists(sidecar):
        return sidecar
    # generate sidecar on-demand
    return ensure_h264_compat(path)


@app.route('/api/videos/delete', methods=['POST'])
def delete_videos():
    data = request.get_json() or {}
    names = data.get('names', [])
    if not names:
        return jsonify({'error': 'No names provided'}), 400

    deleted = []
    errors = []
    for name in names:
        safe = os.path.basename(name)
        path = os.path.join(VIDEO_DIR, safe)
        if not os.path.exists(path):
            errors.append(f'{safe}: not found')
            continue
        try:
            os.remove(path)
            deleted.append(safe)
        except OSError as e:
            errors.append(f'{safe}: {e}')
            continue

        # Clean up sidecar and thumbnail
        sidecar = os.path.splitext(path)[0] + '_h264.mp4'
        if os.path.exists(sidecar):
            try:
                os.remove(sidecar)
            except OSError:
                pass

        thumb = os.path.join(THUMB_DIR, os.path.splitext(safe)[0] + '.jpg')
        if os.path.exists(thumb):
            try:
                os.remove(thumb)
            except OSError:
                pass

    return jsonify({'deleted': deleted, 'errors': errors})


def _merge_worker(job_id, source_paths, output_path, output_name, delete_sources=False):
    def update(status, percent, message):
        with merge_jobs_lock:
            merge_jobs[job_id].update(status=status, percent=percent, message=message)

    try:
        update('running', 5, 'Resolving H.264 sources…')
        h264_paths = []
        for i, src in enumerate(source_paths):
            resolved = _resolve_h264_source(os.path.basename(src))
            if resolved is None:
                update('error', 0, f'Could not find source: {os.path.basename(src)}')
                return
            h264_paths.append(resolved)
            update('running', 5 + int((i + 1) / len(source_paths) * 30), f'Resolved {i+1}/{len(source_paths)}…')

        update('running', 35, 'Writing concat list…')
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as tmp:
            for p in h264_paths:
                # escape single quotes in path for ffmpeg concat format
                escaped = p.replace("'", "'\\''")
                tmp.write(f"file '{escaped}'\n")
            concat_file = tmp.name

        update('running', 40, 'Merging with ffmpeg…')
        cmd = [
            'ffmpeg', '-y', '-f', 'concat', '-safe', '0',
            '-i', concat_file,
            '-c', 'copy',
            '-movflags', '+faststart',
            output_path
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        os.unlink(concat_file)

        if proc.returncode != 0:
            update('error', 0, f'ffmpeg failed: {proc.stderr[-500:]}')
            return

        update('running', 85, 'Generating thumbnail…')
        thumb_name = os.path.splitext(os.path.basename(output_path))[0] + '.jpg'
        thumb_path = os.path.join(THUMB_DIR, thumb_name)
        subprocess.run(
            ['ffmpeg', '-y', '-i', output_path, '-ss', '00:00:02',
             '-vframes', '1', '-q:v', '2', thumb_path],
            capture_output=True
        )

        if delete_sources:
            update('running', 93, 'Deleting original videos…')
            for src in source_paths:
                safe = os.path.basename(src)
                src_path = os.path.join(VIDEO_DIR, safe)
                if os.path.exists(src_path):
                    try:
                        os.remove(src_path)
                    except OSError:
                        pass
                src_sidecar = os.path.splitext(src_path)[0] + '_h264.mp4'
                if os.path.exists(src_sidecar):
                    try:
                        os.remove(src_sidecar)
                    except OSError:
                        pass
                src_thumb = os.path.join(THUMB_DIR, os.path.splitext(safe)[0] + '.jpg')
                if os.path.exists(src_thumb):
                    try:
                        os.remove(src_thumb)
                    except OSError:
                        pass

        with merge_jobs_lock:
            merge_jobs[job_id].update(
                status='success', percent=100,
                message='Merge complete',
                output_name=output_name
            )

    except Exception as e:
        with merge_jobs_lock:
            merge_jobs[job_id].update(status='error', percent=0, message=str(e))


@app.route('/api/videos/merge', methods=['POST'])
def merge_videos_api():
    data = request.get_json() or {}
    names = data.get('names', [])
    friendly_name = (data.get('friendly_name') or '').strip()
    delete_sources = bool(data.get('delete_sources', True))

    if len(names) < 2:
        return jsonify({'error': 'Select at least 2 videos to merge'}), 400

    # Validate all exist
    for name in names:
        safe = os.path.basename(name)
        if not os.path.exists(os.path.join(VIDEO_DIR, safe)):
            return jsonify({'error': f'File not found: {safe}'}), 404

    # Sort by filename timestamp (oldest first) – reuse same pattern as list_videos
    def ts_key(n):
        m = re.search(r'(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})', n)
        return m.group(1) if m else n

    sorted_names = sorted(names, key=ts_key)

    # Build output filename from first/last timestamp
    first_ts = ts_key(sorted_names[0])
    last_ts = ts_key(sorted_names[-1])
    ts_tag = first_ts if first_ts == last_ts else f'{first_ts}_to_{last_ts}'
    output_name = f'video_{ts_tag}_merged_streamable.mp4'
    # Ensure uniqueness
    base, ext = os.path.splitext(output_name)
    counter = 1
    candidate = output_name
    while os.path.exists(os.path.join(VIDEO_DIR, candidate)):
        candidate = f'{base}_{counter}{ext}'
        counter += 1
    output_name = candidate
    output_path = os.path.join(VIDEO_DIR, output_name)

    source_paths = [os.path.join(VIDEO_DIR, os.path.basename(n)) for n in sorted_names]
    job_id = str(uuid.uuid4())

    with merge_jobs_lock:
        merge_jobs[job_id] = {
            'status': 'queued', 'percent': 0,
            'message': 'Queued', 'output_name': output_name,
            'friendly_name': friendly_name,
            'delete_sources': delete_sources
        }

    t = threading.Thread(target=_merge_worker,
                         args=(job_id, source_paths, output_path, output_name, delete_sources),
                         daemon=True)
    t.start()

    # If a friendly name was provided, write it to metadata now
    if friendly_name:
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            try:
                with open(META_FILE, 'r') as mf:
                    metas = json.load(mf)
            except Exception:
                metas = {}
            metas[output_name] = metas.get(output_name, {})
            metas[output_name]['friendly_name'] = friendly_name
            with open(META_FILE, 'w') as mf:
                json.dump(metas, mf, indent=2)
        except Exception:
            pass

    return jsonify({'job_id': job_id, 'output_name': output_name})


@app.route('/api/videos/merge/<job_id>', methods=['GET'])
def merge_status(job_id):
    with merge_jobs_lock:
        job = merge_jobs.get(job_id)
    if job is None:
        return jsonify({'error': 'Unknown job'}), 404
    return jsonify(job)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80)
