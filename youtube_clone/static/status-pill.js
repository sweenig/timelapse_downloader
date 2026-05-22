function formatStatusTime(iso){
  if(!iso) return 'never';
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function renderDownloaderStatus(status){
  const pill = document.getElementById('downloader-pill');
  if(!pill) return;

  const state = (status && status.state ? String(status.state) : 'unknown').toLowerCase();
  const file = status && status.current_file ? String(status.current_file) : null;
  const lastCheck = formatStatusTime(status ? status.last_check : null);
  const lastSuccess = formatStatusTime(status ? status.last_success : null);
  const lastError = status && status.last_error ? String(status.last_error) : null;

  let text = 'Downloader Unknown';
  let cls = 'downloader-pill--unknown';

  if(state === 'idle'){
    text = 'Downloader Idle';
    cls = 'downloader-pill--idle';
  } else if(state === 'working'){
    text = file ? `Downloading: ${file}` : 'Downloader Working';
    cls = 'downloader-pill--working';
  } else if(state === 'starting'){
    text = 'Downloader Starting';
    cls = 'downloader-pill--starting';
  } else if(state === 'error'){
    text = 'Downloader Error';
    cls = 'downloader-pill--error';
  } else if(state === 'unavailable'){
    text = 'Downloader Unavailable';
    cls = 'downloader-pill--unknown';
  }

  pill.classList.remove(
    'downloader-pill--idle',
    'downloader-pill--working',
    'downloader-pill--starting',
    'downloader-pill--error',
    'downloader-pill--unknown'
  );
  pill.classList.add(cls);
  pill.textContent = text;

  const tooltip = [
    `State: ${state}`,
    `Last check: ${lastCheck}`,
    `Last success: ${lastSuccess}`,
    `Current file: ${file || 'none'}`,
    `Last error: ${lastError || 'none'}`,
  ].join('\n');
  pill.title = tooltip;
}

async function refreshDownloaderStatus(){
  try{
    const res = await fetch('/api/downloader-status');
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    renderDownloaderStatus(payload);
  } catch (err){
    renderDownloaderStatus({ state: 'unavailable' });
  }
}

window.addEventListener('load', () => {
  refreshDownloaderStatus();
  setInterval(refreshDownloaderStatus, 15000);
});
