let VIDEOS = [];
let CURRENT = null;

function supportsHevcPlayback(){
  const probe = document.createElement('video');
  if(!probe || typeof probe.canPlayType !== 'function') return false;
  return !!(
    probe.canPlayType('video/mp4; codecs="hvc1"') ||
    probe.canPlayType('video/mp4; codecs="hev1"')
  );
}

function formatTime(seconds){
  if(!seconds || Number.isNaN(seconds)) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hrs > 0 ? `${hrs}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}` : `${mins}:${String(secs).padStart(2,'0')}`;
}

function getQueryVideo(){
  return new URLSearchParams(window.location.search).get('video');
}

function populateMeta(name){
  const v = VIDEOS.find(x=>x.name===name) || {};
  document.getElementById('meta-name').value = v.friendly_name || '';
  document.getElementById('meta-desc').value = v.description || '';
  document.getElementById('meta-link').value = v.maker_link || '';
  updateOpenButton();
}

function updateOpenButton(){
  const openBtn = document.getElementById('meta-open');
  const url = document.getElementById('meta-link').value.trim();
  openBtn.disabled = !url;
}

function openMetaLink(){
  const url = document.getElementById('meta-link').value.trim();
  if(!url) return;
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  window.open(target, '_blank', 'noopener');
}

async function saveMeta(){
  if(!CURRENT) return;
  const button = document.getElementById('meta-save');
  const status = document.getElementById('meta-status');
  const originalText = button.textContent;
  status.textContent = '';
  button.textContent = 'Saving...';
  button.disabled = true;

  const payload = {
    name: CURRENT,
    friendly_name: document.getElementById('meta-name').value.trim(),
    description: document.getElementById('meta-desc').value.trim(),
    maker_link: document.getElementById('meta-link').value.trim()
  };

  const res = await fetch('/api/meta', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });

  if(res.ok){
    const j = await res.json();
    const idx = VIDEOS.findIndex(x=>x.name===CURRENT);
    if(idx>=0){
      VIDEOS[idx] = {...VIDEOS[idx], ...j.entry};
    }
    button.textContent = 'Saved';
    status.classList.remove('error');
    status.textContent = 'Saved';
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
      status.textContent = '';
    }, 1200);
  } else {
    const text = await res.text();
    console.error('Save failed:', text);
    button.textContent = originalText;
    button.disabled = false;
    status.classList.add('error');
    status.textContent = 'Save failed';
  }
}

function loadVideo(name){
  const v = VIDEOS.find(x => x.name === name);
  const player = document.getElementById('player');
  if(!v){
    document.getElementById('now-playing').textContent = 'Video not found';
    document.getElementById('current-duration').textContent = 'Duration: -';
    player.removeAttribute('src');
    player.load();
    return;
  }

  CURRENT = v.name;
  document.getElementById('now-playing').textContent = v.friendly_name || v.name;
  document.getElementById('current-duration').textContent = 'Duration: -';
  const encodedName = encodeURIComponent(v.name);
  const sourceBase = supportsHevcPlayback() ? '/video/' : '/video-h264/';
  player.src = sourceBase + encodedName;
  player.load();
  player.play().catch(() => {});
  populateMeta(v.name);
}

async function init(){
  const res = await fetch('/api/videos');
  VIDEOS = await res.json();
  const startVideo = getQueryVideo();
  if(startVideo){
    loadVideo(startVideo);
  } else if(VIDEOS.length > 0){
    loadVideo(VIDEOS[0].name);
  } else {
    document.getElementById('now-playing').textContent = 'No videos found';
  }
}

window.addEventListener('load', ()=>{
  const player = document.getElementById('player');
  player.addEventListener('loadedmetadata', () => {
    if(!Number.isNaN(player.duration) && player.duration > 0){
      document.getElementById('current-duration').textContent = 'Duration: ' + formatTime(player.duration);
    }
  });
  player.addEventListener('error', (event) => console.error('player event: error', event, player.error));

  document.getElementById('meta-save').addEventListener('click', saveMeta);
  document.getElementById('meta-open').addEventListener('click', openMetaLink);
  document.getElementById('meta-link').addEventListener('input', updateOpenButton);

  init().catch(err => {
    console.error(err);
    document.getElementById('now-playing').textContent = 'Failed to load videos';
  });
});
