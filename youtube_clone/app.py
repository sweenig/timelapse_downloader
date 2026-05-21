from flask import Flask, render_template, jsonify, request, send_file, Response, abort
import os
import json
import mimetypes
import re
import subprocess
from datetime import datetime
from urllib.parse import quote, unquote

VIDEO_DIR = os.environ.get('VIDEO_DIR', '/videos')
DATA_DIR = os.environ.get('DATA_DIR', '/data')
META_FILE = os.path.join(DATA_DIR, 'metadata.json')
THUMB_DIR = os.path.join(DATA_DIR, 'thumbnails')

app = Flask(__name__, static_folder='static', template_folder='templates')


@app.route('/')
def index():
    return render_template('index.html')


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
