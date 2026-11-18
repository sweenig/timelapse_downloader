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

const PAGE_SIZE = 25;
let visibleCount = PAGE_SIZE;
let filteredCards = [];
let infiniteObserver = null;
let currentMetaVideo = null;

function syncHeaderOffset() {
  const header = document.querySelector('.home-page header');
  if (!header) return;
  const px = Math.ceil(header.getBoundingClientRect().height);
  document.body.style.setProperty('--home-header-offset', `${px}px`);
}

function supportsHevcPlayback() {
  const probe = document.createElement('video');
  if (!probe || typeof probe.canPlayType !== 'function') return false;
  return !!(
    probe.canPlayType('video/mp4; codecs="hvc1"') ||
    probe.canPlayType('video/mp4; codecs="hev1"')
  );
}

function updateInfiniteStatus(totalResults) {
  const status = document.getElementById('home-infinite-status');
  if (!status) return;
  if (totalResults === 0) {
    status.textContent = '0 results';
    return;
  }
  const shown = Math.min(visibleCount, totalResults);
  if (shown < totalResults) {
    status.textContent = `Showing ${shown} of ${totalResults} videos. Scroll for more.`;
  } else {
    status.textContent = `Showing all ${totalResults} videos.`;
  }
}

function renderVisibleCards() {
  const cards = Array.from(document.querySelectorAll('#video-list li[data-video-card="1"]'));
  const empty = document.getElementById('home-empty');
  const sentinel = document.getElementById('home-infinite-sentinel');
  const totalResults = filteredCards.length;

  cards.forEach(card => {
    card.style.display = 'none';
    stopCardPreview(card);
  });

  filteredCards.slice(0, visibleCount).forEach(card => {
    card.style.display = '';
  });

  if (empty) {
    empty.style.display = totalResults === 0 ? '' : 'none';
  }

  if (sentinel) {
    sentinel.style.display = visibleCount < totalResults ? '' : 'none';
  }

  updateInfiniteStatus(totalResults);
  updateActionBar();
}

function loadNextChunk() {
  if (visibleCount >= filteredCards.length) return;
  visibleCount = Math.min(filteredCards.length, visibleCount + PAGE_SIZE);
  renderVisibleCards();
}

function setupInfiniteObserver() {
  const sentinel = document.getElementById('home-infinite-sentinel');
  if (!sentinel) return;

  if (infiniteObserver) {
    infiniteObserver.disconnect();
  }

  infiniteObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        loadNextChunk();
      }
    });
  }, {
    root: null,
    rootMargin: '240px 0px',
    threshold: 0.01
  });

  infiniteObserver.observe(sentinel);
}

function stopCardPreview(card) {
  const img = card.querySelector('.home-preview-image');
  const video = card.querySelector('.home-preview-video');
  if (!img || !video) return;
  video.pause();
  try {
    video.currentTime = 0;
  } catch (_) {
    // Ignore currentTime errors if metadata has not loaded yet.
  }
  video.classList.remove('is-visible');
  img.classList.remove('is-hidden');
}

function initHoverPreviews() {
  const canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  if (!canHover) return;

  const sourceBase = supportsHevcPlayback() ? '/video/' : '/video-h264/';
  const cards = Array.from(document.querySelectorAll('#video-list li[data-video-card="1"]'));

  cards.forEach(card => {
    const thumb = card.querySelector('.video-thumb');
    const img = card.querySelector('.home-preview-image');
    const video = card.querySelector('.home-preview-video');
    const name = card.dataset.fileName || '';
    if (!thumb || !img || !video || !name) return;

    let loaded = false;

    const startPreview = () => {
      if (card.style.display === 'none') return;
      if (!loaded) {
        video.src = sourceBase + encodeURIComponent(name);
        loaded = true;
      }
      video.classList.add('is-visible');
      img.classList.add('is-hidden');
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          video.classList.remove('is-visible');
          img.classList.remove('is-hidden');
        });
      }
    };

    const stopPreview = () => stopCardPreview(card);

    thumb.addEventListener('mouseenter', startPreview);
    thumb.addEventListener('mouseleave', stopPreview);
  });
}

function getCheckedCards() {
  const list = document.getElementById('video-list');
  const checks = Array.from(list.querySelectorAll('.home-manage-checkbox:checked'));
  return checks.map(cb => cb.closest('li[data-video-card="1"]')).filter(Boolean);
}

function getCheckedNames() {
  return getCheckedCards().map(card => card.dataset.fileName || '').filter(Boolean);
}

function updateActionBar() {
  const allCards = Array.from(document.querySelectorAll('#video-list li[data-video-card="1"]'));
  const visibleCards = allCards.filter(card => card.style.display !== 'none');
  const checkedCards = getCheckedCards();
  const selectedCount = document.getElementById('home-selected-count');
  const selectAll = document.getElementById('home-select-all');
  const editBtn = document.getElementById('home-edit-meta-btn');
  const deleteBtn = document.getElementById('home-delete-btn');
  const mergeBtn = document.getElementById('home-merge-btn');

  const n = checkedCards.length;
  selectedCount.textContent = n === 1 ? '1 selected' : `${n} selected`;
  editBtn.disabled = n !== 1;
  deleteBtn.disabled = n === 0;
  mergeBtn.disabled = n < 2;

  if (visibleCards.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  const visibleSelected = visibleCards.filter(card => {
    const cb = card.querySelector('.home-manage-checkbox');
    return cb && cb.checked;
  }).length;

  selectAll.checked = visibleSelected > 0 && visibleSelected === visibleCards.length;
  selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleCards.length;
}

function updateCardMetadataUI(card, entry) {
  const fileName = card.dataset.fileName || '';
  card.dataset.friendlyName = entry.friendly_name || '';
  card.dataset.description = entry.description || '';
  card.dataset.makerLink = entry.maker_link || '';
  const display = entry.friendly_name || fileName;
  card.dataset.sortName = display.toLowerCase();
  card.dataset.search = `${entry.friendly_name || ''} ${fileName}`.toLowerCase();

  const titleEl = card.querySelector('.video-title');
  if (titleEl) titleEl.textContent = display;

  const extraFileEl = card.querySelector('.video-file-name-extra');
  if (extraFileEl) {
    if (entry.friendly_name) {
      extraFileEl.style.display = '';
      extraFileEl.textContent = ` (${fileName})`;
    } else {
      extraFileEl.style.display = 'none';
      extraFileEl.textContent = ` (${fileName})`;
    }
  }
}

function findCardByName(name) {
  const list = document.getElementById('video-list');
  return list.querySelector(`li[data-video-card="1"][data-file-name="${CSS.escape(name)}"]`);
}

function openMetaDialog(name) {
  const card = findCardByName(name);
  if (!card) return;
  currentMetaVideo = name;
  document.getElementById('meta-dialog-desc').textContent = name;
  document.getElementById('home-meta-name').value = card.dataset.friendlyName || '';
  document.getElementById('home-meta-desc').value = card.dataset.description || '';
  document.getElementById('home-meta-link').value = card.dataset.makerLink || '';
  document.getElementById('home-meta-status').textContent = '';
  document.getElementById('home-meta-status').classList.remove('error');
  document.getElementById('meta-dialog-overlay').style.display = 'flex';
  document.getElementById('home-meta-name').focus();
}

function closeMetaDialog() {
  currentMetaVideo = null;
  document.getElementById('meta-dialog-overlay').style.display = 'none';
}

async function saveMetadata() {
  if (!currentMetaVideo) return;
  const saveBtn = document.getElementById('home-meta-save-btn');
  const status = document.getElementById('home-meta-status');
  const payload = {
    name: currentMetaVideo,
    friendly_name: document.getElementById('home-meta-name').value.trim(),
    description: document.getElementById('home-meta-desc').value.trim(),
    maker_link: document.getElementById('home-meta-link').value.trim()
  };

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  status.textContent = '';
  status.classList.remove('error');

  try {
    const res = await fetch('/api/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      status.textContent = 'Save failed';
      status.classList.add('error');
      return;
    }

    const data = await res.json();
    const card = findCardByName(currentMetaVideo);
    if (card) {
      updateCardMetadataUI(card, data.entry || {});
    }
    status.textContent = 'Saved';
    applySortAndFilter();
    setTimeout(closeMetaDialog, 400);
  } catch (error) {
    status.textContent = 'Save failed';
    status.classList.add('error');
    console.error('Failed to save metadata', error);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

async function deleteSelected() {
  const names = getCheckedNames();
  if (names.length === 0) return;
  const noun = names.length === 1 ? '1 video' : `${names.length} videos`;
  if (!confirm(`Delete ${noun} permanently from the server?\n\n${names.join('\n')}`)) return;

  const deleteBtn = document.getElementById('home-delete-btn');
  deleteBtn.disabled = true;
  const prevText = deleteBtn.textContent;
  deleteBtn.textContent = 'Deleting...';

  try {
    const res = await fetch('/api/videos/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names })
    });

    const data = await res.json();
    if (!res.ok) {
      alert('Delete failed: ' + (data.error || res.statusText));
      return;
    }

    (data.deleted || []).forEach(name => {
      const card = findCardByName(name);
      if (card) card.remove();
    });

    if (data.errors && data.errors.length) {
      alert('Some deletions failed:\n' + data.errors.join('\n'));
    }
    applySortAndFilter({ resetPage: true });
  } finally {
    deleteBtn.textContent = prevText;
    updateActionBar();
  }
}

function setupMergeUI() {
  const mergeBtn = document.getElementById('home-merge-btn');
  const mergeOverlay = document.getElementById('merge-dialog-overlay');
  const mergeDesc = document.getElementById('merge-dialog-desc');
  const mergeName = document.getElementById('merge-friendly-name');
  const mergeDeleteOrig = document.getElementById('merge-delete-originals');
  const mergeCancelBtn = document.getElementById('merge-cancel-btn');
  const mergeConfirmBtn = document.getElementById('merge-confirm-btn');

  const progressOverlay = document.getElementById('merge-progress-overlay');
  const progressMsg = document.getElementById('merge-progress-msg');
  const progressBar = document.getElementById('merge-progress-bar');
  const progressActions = document.getElementById('merge-progress-actions');
  const mergeDoneBtn = document.getElementById('merge-done-btn');

  mergeBtn.addEventListener('click', function () {
    const names = getCheckedNames();
    if (names.length < 2) return;
    mergeDesc.textContent = `Merge ${names.length} videos into one (oldest first)?`;
    mergeName.value = '';
    mergeDeleteOrig.checked = true;
    mergeOverlay.style.display = 'flex';
    mergeName.focus();
  });

  mergeCancelBtn.addEventListener('click', function () {
    mergeOverlay.style.display = 'none';
  });

  mergeOverlay.addEventListener('click', function (event) {
    if (event.target === mergeOverlay) mergeOverlay.style.display = 'none';
  });

  mergeDoneBtn.addEventListener('click', function () {
    progressOverlay.style.display = 'none';
  });

  mergeConfirmBtn.addEventListener('click', async function () {
    const names = getCheckedNames();
    const friendlyName = mergeName.value.trim();
    const deleteSources = !!mergeDeleteOrig.checked;
    mergeOverlay.style.display = 'none';

    progressMsg.textContent = 'Starting merge...';
    progressBar.style.width = '0%';
    progressBar.classList.remove('merge-progress-bar--success', 'merge-progress-bar--error');
    progressActions.style.display = 'none';
    progressOverlay.style.display = 'flex';

    try {
      const res = await fetch('/api/videos/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          names,
          friendly_name: friendlyName,
          delete_sources: deleteSources
        })
      });
      const data = await res.json();
      if (!res.ok) {
        progressMsg.textContent = 'Error: ' + (data.error || res.statusText);
        progressBar.classList.add('merge-progress-bar--error');
        progressActions.style.display = '';
        return;
      }

      pollMergeJob(data.job_id, {
        progressMsg,
        progressBar,
        progressActions,
        progressOverlay,
        mergeDoneBtn
      });
    } catch (error) {
      progressMsg.textContent = 'Network error: ' + error.message;
      progressBar.classList.add('merge-progress-bar--error');
      progressActions.style.display = '';
    }
  });
}

function pollMergeJob(jobId, ui) {
  const { progressMsg, progressBar, progressActions, progressOverlay, mergeDoneBtn } = ui;
  const interval = setInterval(async function () {
    try {
      const res = await fetch(`/api/videos/merge/${jobId}`);
      const job = await res.json();

      progressMsg.textContent = job.message || '';
      progressBar.style.width = (job.percent || 0) + '%';

      if (job.status === 'success') {
        clearInterval(interval);
        progressBar.classList.add('merge-progress-bar--success');
        progressMsg.textContent = `Merge complete -> ${job.output_name}`;
        progressActions.style.display = '';
        mergeDoneBtn.onclick = function () {
          progressOverlay.style.display = 'none';
          location.reload();
        };
      } else if (job.status === 'error') {
        clearInterval(interval);
        progressBar.classList.add('merge-progress-bar--error');
        progressActions.style.display = '';
        mergeDoneBtn.onclick = function () {
          progressOverlay.style.display = 'none';
        };
      }
    } catch (_) {
      // Keep polling during transient network issues.
    }
  }, 1500);
}

function applySortAndFilter({ resetPage = false } = {}){
  const list = document.getElementById('video-list');
  const cards = Array.from(list.querySelectorAll('li[data-video-card="1"]'));
  const sortBy = document.getElementById('home-sort').value;
  const order = document.getElementById('home-order').value;
  const query = document.getElementById('home-search').value.trim().toLowerCase();

  cards.sort((a, b) => {
    let va;
    let vb;
    if(sortBy === 'name'){
      va = a.dataset.sortName || a.dataset.fileName || '';
      vb = b.dataset.sortName || b.dataset.fileName || '';
      if(va < vb) return order === 'asc' ? -1 : 1;
      if(va > vb) return order === 'asc' ? 1 : -1;
      return 0;
    }
    va = Number(a.dataset.ts || 0);
    vb = Number(b.dataset.ts || 0);
    if(va < vb) return order === 'asc' ? -1 : 1;
    if(va > vb) return order === 'asc' ? 1 : -1;
    return 0;
  });

  filteredCards = [];
  cards.forEach(card => {
    list.appendChild(card);
    const haystack = card.dataset.search || '';
    const match = !query || haystack.includes(query);
    if(match) filteredCards.push(card);
  });

  if (resetPage) {
    visibleCount = PAGE_SIZE;
  } else if (visibleCount < PAGE_SIZE) {
    visibleCount = PAGE_SIZE;
  }

  renderVisibleCards();
}

window.addEventListener('load', () => {
  syncHeaderOffset();
  window.addEventListener('resize', syncHeaderOffset);
  updateAviCount();
  const search = document.getElementById('home-search');
  const sort = document.getElementById('home-sort');
  const order = document.getElementById('home-order');
  const list = document.getElementById('video-list');
  const selectAll = document.getElementById('home-select-all');
  const editMetaBtn = document.getElementById('home-edit-meta-btn');
  const deleteBtn = document.getElementById('home-delete-btn');
  const metaOverlay = document.getElementById('meta-dialog-overlay');
  const metaCancelBtn = document.getElementById('home-meta-cancel-btn');
  const metaSaveBtn = document.getElementById('home-meta-save-btn');

  search.addEventListener('input', () => applySortAndFilter({ resetPage: true }));
  sort.addEventListener('change', () => applySortAndFilter({ resetPage: true }));
  order.addEventListener('change', () => applySortAndFilter({ resetPage: true }));

  list.addEventListener('change', (event) => {
    if (!event.target.classList.contains('home-manage-checkbox')) return;
    event.target.closest('li[data-video-card="1"]').classList.toggle('manage-card--selected', event.target.checked);
    updateActionBar();
  });

  list.addEventListener('click', (event) => {
    const btn = event.target.closest('button.home-edit-btn');
    if (!btn) return;
    openMetaDialog(btn.dataset.name || '');
  });

  selectAll.addEventListener('change', () => {
    const visibleCards = Array.from(document.querySelectorAll('#video-list li[data-video-card="1"]'))
      .filter(card => card.style.display !== 'none');
    visibleCards.forEach(card => {
      const cb = card.querySelector('.home-manage-checkbox');
      if (!cb) return;
      cb.checked = selectAll.checked;
      card.classList.toggle('manage-card--selected', selectAll.checked);
    });
    updateActionBar();
  });

  editMetaBtn.addEventListener('click', () => {
    const names = getCheckedNames();
    if (names.length === 1) openMetaDialog(names[0]);
  });

  deleteBtn.addEventListener('click', deleteSelected);
  metaCancelBtn.addEventListener('click', closeMetaDialog);
  metaSaveBtn.addEventListener('click', saveMetadata);
  metaOverlay.addEventListener('click', (event) => {
    if (event.target === metaOverlay) closeMetaDialog();
  });

  setupMergeUI();
  initHoverPreviews();
  setupInfiniteObserver();

  applySortAndFilter({ resetPage: true });
});
