from flask import Flask, render_template, jsonify, request, send_file, Response, abort
import os
import json
import mimetypes
import re
import subprocess
import threading
import time
from datetime import datetime
from urllib.parse import quote, unquote

VIDEO_DIR = os.environ.get('VIDEO_DIR', '/videos')
DATA_DIR = os.environ.get('DATA_DIR', '/data')
META_FILE = os.path.join(DATA_DIR, 'metadata.json')
THUMB_DIR = os.path.join(DATA_DIR, 'thumbnails')

app = Flask(__name__, static_folder='static', template_folder='templates')

# Conversion queue and status tracking for .avi -> mp4 jobs
convert_queue = []
convert_status = {}  # name -> {status: 'queued'|'running'|'success'|'error', percent:0, message:''}
queue_lock = threading.Lock()


def list_avi_files():
    try:
        files = [
            f for f in os.listdir(VIDEO_DIR)
            if os.path.isfile(os.path.join(VIDEO_DIR, f)) and f.lower().endswith('.avi')
        ]
    except Exception:
        files = []
    return sorted(files)


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
    return render_template('index.html')


@app.route('/avi')
def avi_page():
    return render_template('avi.html')


@app.route('/api/videos')
def api_videos():
    try:
        files = [f for f in os.listdir(VIDEO_DIR) if os.path.isfile(os.path.join(VIDEO_DIR, f))]
    except Exception:
        files = []
    videos = []
    for f in files:
        if f.lower().endswith(('.mp4', '.webm', '.ogg', '.mov', '.mkv')):
            path = os.path.join(VIDEO_DIR, f)
            try:
                size = os.path.getsize(path)
            except Exception:
                size = 0
            # Parse filename pattern: video_YYYY-MM-DD_HH-mm-SS_optional.mp4
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
            # merge saved metadata if available
            try:
                with open(META_FILE, 'r') as mf:
                    metas = json.load(mf)
            except Exception:
                metas = {}
            saved = metas.get(f, {})
            if saved:
                meta.update(saved)
            meta['thumbnail'] = '/thumbnail/' + quote(f)
            videos.append(meta)
    videos.sort(key=lambda x: x['name'])
    return jsonify(videos)


@app.route('/api/avi-count')
def api_avi_count():
    count = len(list_avi_files())
    return jsonify({'count': count})


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
    path = os.path.join(VIDEO_DIR, filename)
    if not os.path.exists(path):
        abort(404)
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    file_size = os.path.getsize(path)
    range_header = request.headers.get('Range', None)
    if range_header:
        m = re.search(r'bytes=(\d+)-(\d*)', range_header)
        if m:
            start = int(m.group(1))
            end = m.group(2)
            end = int(end) if end else file_size - 1
            if end >= file_size:
                end = file_size - 1
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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80)
