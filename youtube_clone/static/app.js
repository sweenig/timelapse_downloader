const APP_VERSION = '5';
let VIDEOS = [];
let CURRENT = null;

async function loadList(){
  const res = await fetch('/api/videos');
  VIDEOS = await res.json();
  renderList();
}

async function updateAviCount(){
  try{
    const res = await fetch('/api/avi-count');
    if(!res.ok) return;
    const { count } = await res.json();
    const pill = document.getElementById('avi-pill');
    pill.textContent = `${count} .avi`;
    pill.classList.remove('avi-pill--green','avi-pill--yellow','avi-pill--red');
    if(count <= 0){
      pill.classList.add('avi-pill--green');
    } else if(count === 1){
      pill.classList.add('avi-pill--yellow');
    } else {
      pill.classList.add('avi-pill--red');
    }
  } catch (e) {
    console.warn('Unable to load AVI count', e);
  }
}

function renderList(){
  const sortBy = document.getElementById('sort-select').value;
  const order = document.getElementById('order-select').value;
  let arr = [...VIDEOS];
  arr.sort((a,b)=>{
    let va, vb;
    if(sortBy==='name'){
      va = a.name.toLowerCase(); vb = b.name.toLowerCase();
    } else if(sortBy==='date'){
      va = a.ts || 0; vb = b.ts || 0;
    } else if(sortBy==='size'){
      va = a.size || 0; vb = b.size || 0;
    }
    if(va < vb) return order==='asc' ? -1 : 1;
    if(va > vb) return order==='asc' ? 1 : -1;
    return 0;
  });
  const list = document.getElementById('video-list');
  list.innerHTML = '';
  if(arr.length===0){
    list.innerHTML = '<li>No videos found</li>';
    return;
  }
  arr.forEach(v => {
    const li = document.createElement('li');
    li.dataset.name = v.name;
    li.tabIndex = 0;
    li.style.cursor = 'pointer';
    const row = document.createElement('div');
    row.className = 'video-row';
    const thumb = document.createElement('div');
    thumb.className = 'video-thumb';
    const img = document.createElement('img');
    img.src = v.thumbnail;
    img.alt = `${v.name} thumbnail`;
    img.onerror = () => img.style.display = 'none';
    thumb.appendChild(img);
    const info = document.createElement('div');
    info.className = 'video-info';
    const displayName = v.friendly_name || v.name;
    const title = document.createElement('div');
    title.textContent = displayName;
    title.className = 'video-title';
    const meta = document.createElement('div');
    meta.className = 'video-meta';
    const dateText = v.timestamp ? `${v.date} ${v.time}` : 'Unknown time';
    const durationText = v.duration ? ` · ${formatTime(v.duration)}` : '';
    const fileText = v.friendly_name ? ` (${v.name})` : '';
    const flagText = v.streamable ? ' · streamable' : '';
    meta.textContent = dateText + durationText + flagText + fileText;
    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(thumb);
    row.appendChild(info);
    li.appendChild(row);
    if(CURRENT && v.name === CURRENT){
      li.classList.add('playing');
    }
    list.appendChild(li);
    if(!v.duration && !v.durationLoading && !v.durationError){
      queueDuration(v);
    }
  });
}

function formatBytes(bytes){
  if(bytes===0) return '0 B';
  const k=1024, dm=2, sizes=['B','KB','MB','GB','TB'];
  const i=Math.floor(Math.log(bytes)/Math.log(k));
  return parseFloat((bytes/Math.pow(k,i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatTime(seconds){
  if(!seconds || Number.isNaN(seconds)) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hrs > 0 ? `${hrs}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}` : `${mins}:${String(secs).padStart(2,'0')}`;
}

let durationQueue = [];
let durationLoader = null;

function queueDuration(v){
  v.durationLoading = true;
  durationQueue.push(v);
  if(!durationLoader){
    processDurationQueue();
  }
}

function processDurationQueue(){
  durationLoader = document.createElement('video');
  durationLoader.preload = 'metadata';
  durationLoader.muted = true;
  durationLoader.style.display = 'none';
  document.body.appendChild(durationLoader);

  const next = () => {
    const v = durationQueue.shift();
    if(!v){
      durationLoader.remove();
      durationLoader = null;
      return;
    }
    const src = '/video/' + encodeURIComponent(v.name);
    durationLoader.onloadedmetadata = () => {
      v.duration = durationLoader.duration;
      v.durationLoading = false;
      renderList();
      next();
    };
    durationLoader.onerror = () => {
      v.durationError = true;
      v.durationLoading = false;
      renderList();
      next();
    };
    durationLoader.src = src;
    durationLoader.load();
  };

  next();
}

function getQueryVideo(){
  return new URLSearchParams(window.location.search).get('video');
}

function updateUrlForVideo(name){
  const url = new URL(window.location.href);
  if(name){
    url.searchParams.set('video', name);
  } else {
    url.searchParams.delete('video');
  }
  window.history.replaceState({}, '', url);
}

function setPlayerSectionVisible(visible){
  document.getElementById('player-section').classList.toggle('hidden', !visible);
}

function onVideoListClick(event){
  const li = event.target.closest('li[data-name]');
  if(!li) return;
  const name = li.dataset.name;
  play(name);
}

function play(name){
  if(!name){
    return;
  }

  const player = document.getElementById('player');
  const sameVideo = CURRENT === name;
  if(sameVideo){
    if(player.paused || player.ended){
      player.play().catch(err => {
        if(err && err.name === 'AbortError') return;
        console.warn('player.play() rejected for', name, err);
      });
    }
    return;
  }

  setPlayerSectionVisible(true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateUrlForVideo(name);
  player.pause();
  player.src = '/video/' + encodeURIComponent(name);
  player.load();
  player.play().catch(err => {
    // AbortError is expected when a new video replaces a pending play request.
    if(err && err.name === 'AbortError') return;
    console.warn('player.play() rejected for', name, err);
  });
  const v = VIDEOS.find(x=>x.name===name) || {};
  document.getElementById('now-playing').textContent = v.friendly_name || name;
  document.getElementById('current-duration').textContent = 'Duration: —';
  CURRENT = name;
  renderList();
  populateMeta(name);
}

function populateMeta(name){
  const v = VIDEOS.find(x=>x.name===name) || {};
  const linkInput = document.getElementById('meta-link');
  document.getElementById('meta-name').value = v.friendly_name || '';
  document.getElementById('meta-desc').value = v.description || '';
  linkInput.value = v.maker_link || '';
  updateOpenButton();
  updateCollapsedView();
}

function updateCollapsedView(){
  const container = document.getElementById('meta-collapsed');
  const v = VIDEOS.find(x=>x.name===CURRENT) || {};
  const display = v.friendly_name || CURRENT || '';
  container.textContent = display;
}

function setCollapsed(collapsed){
  const editor = document.getElementById('meta-editor');
  const toggle = document.getElementById('meta-toggle');
  if(collapsed){
    editor.classList.add('collapsed');
    toggle.textContent = '▸';
    toggle.setAttribute('aria-expanded','false');
  } else {
    editor.classList.remove('collapsed');
    toggle.textContent = '▾';
    toggle.setAttribute('aria-expanded','true');
  }
  try{ localStorage.setItem('metaCollapsed',''+(collapsed?1:0)); }catch(e){}
}

function toggleMeta(){
  const editor = document.getElementById('meta-editor');
  const is = editor.classList.contains('collapsed');
  setCollapsed(!is);
}

function updateOpenButton(){
  const openBtn = document.getElementById('meta-open');
  const url = document.getElementById('meta-link').value.trim();
  openBtn.disabled = !url;
}

function openMetaLink(){
  const url = document.getElementById('meta-link').value.trim();
  if(!url) return;
  let target = url;
  if(!/^https?:\/\//i.test(target)){
    target = 'https://' + target;
  }
  window.open(target, '_blank', 'noopener');
}

async function saveMeta(){
  if(!CURRENT) return;
  const button = document.getElementById('meta-save');
  const status = document.getElementById('meta-status');
  const originalText = button.textContent;
  status.textContent = '';
  button.textContent = 'Saving…';
  button.disabled = true;
  const payload = {
    name: CURRENT,
    friendly_name: document.getElementById('meta-name').value.trim(),
    description: document.getElementById('meta-desc').value.trim(),
    maker_link: document.getElementById('meta-link').value.trim()
  };
  const res = await fetch('/api/meta', {method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)});
  if(res.ok){
    const j = await res.json();
    const idx = VIDEOS.findIndex(x=>x.name===CURRENT);
    if(idx>=0){
      VIDEOS[idx] = {...VIDEOS[idx], ...j.entry};
      renderList();
    }
    button.textContent = '✓';
    status.classList.remove('error');
    status.textContent = 'Saved';
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
      status.textContent = '';
    }, 1500);
  } else {
    const text = await res.text();
    button.textContent = originalText;
    button.disabled = false;
    status.classList.add('error');
    status.textContent = 'Save failed';
    console.error('Save failed:', text);
  }
}

window.addEventListener('load', ()=>{
  loadList().then(()=>{
    const startVideo = getQueryVideo();
    if(startVideo && VIDEOS.some(v => v.name === startVideo)){
      play(startVideo);
    } else {
      setPlayerSectionVisible(false);
    }
  });
  updateAviCount();
  document.getElementById('sort-select').addEventListener('change', renderList);
  document.getElementById('order-select').addEventListener('change', renderList);
  document.getElementById('meta-save').addEventListener('click', saveMeta);
  document.getElementById('meta-open').addEventListener('click', openMetaLink);
  document.getElementById('meta-link').addEventListener('input', updateOpenButton);
  const videoListEl = document.getElementById('video-list');
  videoListEl.addEventListener('click', onVideoListClick);
  const player = document.getElementById('player');
  player.addEventListener('loadedmetadata', () => {
    if(!Number.isNaN(player.duration) && player.duration > 0){
      document.getElementById('current-duration').textContent = 'Duration: ' + formatTime(player.duration);
    }
  });
  player.addEventListener('error', (event) => console.error('player event: error', event, player.error));
  // initialize collapsed state
  const collapsed = !!(localStorage.getItem('metaCollapsed') === '1');
  setCollapsed(collapsed);
  document.getElementById('meta-toggle').addEventListener('click', toggleMeta);
 });
