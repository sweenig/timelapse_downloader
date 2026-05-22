let AVI_ITEMS = [];
let pollTimer = null;

function formatBytes(bytes){
  if(!bytes || bytes <= 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exp);
  return `${value.toFixed(exp === 0 ? 0 : 2)} ${units[exp]}`;
}

function statusText(item){
  if(item.status === 'queued'){
    if(item.queue_position){
      return `Queued (#${item.queue_position})`;
    }
    return 'Queued';
  }
  if(item.status === 'running'){
    return `Converting ${item.percent || 0}%`;
  }
  if(item.status === 'success') return 'Converted';
  if(item.status === 'error') return item.message || 'Conversion failed';
  return 'Ready';
}

function renderAviList(){
  const list = document.getElementById('avi-list');
  const summary = document.getElementById('avi-summary');
  const convertAllBtn = document.getElementById('convert-all');
  const banner = document.getElementById('avi-status-banner');

  list.innerHTML = '';

  if(AVI_ITEMS.length === 0){
    summary.textContent = 'No .avi files found.';
    banner.textContent = 'Queue is idle.';
    banner.className = 'avi-status-banner avi-status-banner--idle';
    convertAllBtn.disabled = true;
    list.innerHTML = '<li class="avi-empty">Everything is already converted.</li>';
    return;
  }

  const queued = AVI_ITEMS.filter(x => x.status === 'queued').length;
  const running = AVI_ITEMS.filter(x => x.status === 'running').length;
  const failed = AVI_ITEMS.filter(x => x.status === 'error').length;

  summary.textContent = `${AVI_ITEMS.length} AVI file(s) found`;
  convertAllBtn.disabled = AVI_ITEMS.every(x => x.status === 'queued' || x.status === 'running');

  if(running > 0){
    banner.textContent = `${running} conversion running, ${queued} queued`;
    banner.className = 'avi-status-banner avi-status-banner--running';
  } else if(queued > 0){
    banner.textContent = `${queued} file(s) queued`;
    banner.className = 'avi-status-banner avi-status-banner--queued';
  } else if(failed > 0){
    banner.textContent = `${failed} file(s) failed. You can retry individual files.`;
    banner.className = 'avi-status-banner avi-status-banner--error';
  } else {
    banner.textContent = 'Queue is idle.';
    banner.className = 'avi-status-banner avi-status-banner--idle';
  }

  AVI_ITEMS.forEach(item => {
    const li = document.createElement('li');
    li.className = 'avi-item';

    const top = document.createElement('div');
    top.className = 'avi-item-top';

    const left = document.createElement('div');
    left.className = 'avi-file-meta';

    const name = document.createElement('div');
    name.className = 'avi-file-name';
    name.textContent = item.name;

    const details = document.createElement('div');
    details.className = 'avi-file-details';
    details.textContent = `${formatBytes(item.size)} | ${statusText(item)}`;

    left.appendChild(name);
    left.appendChild(details);

    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = item.status === 'running' ? 'Converting...' : 'Convert';
    action.disabled = item.status === 'queued' || item.status === 'running';
    action.addEventListener('click', () => convertOne(item.name));

    top.appendChild(left);
    top.appendChild(action);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'avi-progress-wrap';
    const bar = document.createElement('div');
    bar.className = 'avi-progress-bar';
    const fill = document.createElement('div');
    fill.className = 'avi-progress-fill';
    fill.style.width = `${Math.max(0, Math.min(100, item.percent || 0))}%`;

    if(item.status === 'error') fill.classList.add('avi-progress-fill--error');
    if(item.status === 'success') fill.classList.add('avi-progress-fill--done');

    bar.appendChild(fill);
    progressWrap.appendChild(bar);

    li.appendChild(top);
    li.appendChild(progressWrap);
    list.appendChild(li);
  });
}

async function loadAviFiles(){
  const res = await fetch('/api/avi-files');
  if(!res.ok){
    throw new Error(`Failed to fetch AVI files: ${res.status}`);
  }
  const payload = await res.json();
  AVI_ITEMS = payload.items || [];
  renderAviList();
}

async function convertOne(name){
  const res = await fetch('/api/avi-convert', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({name})
  });
  if(!res.ok){
    const text = await res.text();
    console.error('Convert failed:', text);
  }
  await loadAviFiles();
}

async function convertAll(){
  const btn = document.getElementById('convert-all');
  const previous = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Queueing...';
  try{
    const res = await fetch('/api/avi-convert-all', {method:'POST'});
    if(!res.ok){
      const text = await res.text();
      console.error('Convert all failed:', text);
    }
  } finally {
    btn.textContent = previous;
    await loadAviFiles();
  }
}

function startPolling(){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try{
      await loadAviFiles();
    } catch (err){
      console.warn('Polling failed', err);
    }
  }, 2000);
}

window.addEventListener('load', async () => {
  document.getElementById('convert-all').addEventListener('click', convertAll);
  try{
    await loadAviFiles();
  } catch (err){
    console.error(err);
  }
  startPolling();
});