/* manage.js — video management page logic */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let allCards = [];   // Array of <li> elements
  let filtered = [];   // After search/sort

  const searchEl      = document.getElementById('manage-search');
  const sortEl        = document.getElementById('manage-sort');
  const orderEl       = document.getElementById('manage-order');
  const selectAllEl   = document.getElementById('manage-select-all');
  const selectedCount = document.getElementById('manage-selected-count');
  const deleteBtn     = document.getElementById('manage-delete-btn');
  const mergeBtn      = document.getElementById('manage-merge-btn');
  const emptyLi       = document.getElementById('manage-empty');
  const listEl        = document.getElementById('manage-video-list');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getChecked() {
    return Array.from(listEl.querySelectorAll('.manage-checkbox:checked'))
                .map(cb => cb.dataset.name);
  }

  function updateActionBar() {
    const checked = getChecked();
    const n = checked.length;
    selectedCount.textContent = n === 1 ? '1 selected' : `${n} selected`;
    deleteBtn.disabled = n === 0;
    mergeBtn.disabled  = n < 2;
    // Update select-all indeterminate state
    const total = filtered.filter(li => li.style.display !== 'none').length;
    selectAllEl.indeterminate = n > 0 && n < total;
    selectAllEl.checked = total > 0 && n === total;
  }

  // ── Sort / filter ──────────────────────────────────────────────────────────
  function applySortAndFilter() {
    const query  = (searchEl.value || '').toLowerCase().trim();
    const sortBy = sortEl.value;
    const order  = orderEl.value;

    filtered = allCards.filter(li => {
      if (!query) return true;
      return (li.dataset.search || '').includes(query);
    });

    filtered.sort((a, b) => {
      let av, bv;
      if (sortBy === 'name') {
        av = a.dataset.sortName || '';
        bv = b.dataset.sortName || '';
      } else {
        av = parseInt(a.dataset.ts || '0', 10);
        bv = parseInt(b.dataset.ts || '0', 10);
      }
      if (av < bv) return order === 'asc' ? -1 : 1;
      if (av > bv) return order === 'asc' ? 1 : -1;
      return 0;
    });

    // Hide all, then show filtered in sorted order
    allCards.forEach(li => { li.style.display = 'none'; });
    filtered.forEach(li => {
      li.style.display = '';
      listEl.appendChild(li);
    });

    if (emptyLi) emptyLi.style.display = filtered.length === 0 ? '' : 'none';
    updateActionBar();
  }

  // ── Checkbox wiring ────────────────────────────────────────────────────────
  listEl.addEventListener('change', function (e) {
    if (e.target.classList.contains('manage-checkbox')) {
      const li = e.target.closest('li.manage-card');
      if (li) li.classList.toggle('manage-card--selected', e.target.checked);
      updateActionBar();
    }
  });

  selectAllEl.addEventListener('change', function () {
    const visible = filtered.filter(li => li.style.display !== 'none');
    visible.forEach(li => {
      const cb = li.querySelector('.manage-checkbox');
      if (cb) {
        cb.checked = selectAllEl.checked;
        li.classList.toggle('manage-card--selected', selectAllEl.checked);
      }
    });
    updateActionBar();
  });

  searchEl.addEventListener('input',  applySortAndFilter);
  sortEl.addEventListener('change',   applySortAndFilter);
  orderEl.addEventListener('change',  applySortAndFilter);

  // ── Delete ─────────────────────────────────────────────────────────────────
  deleteBtn.addEventListener('click', async function () {
    const names = getChecked();
    if (names.length === 0) return;
    const noun = names.length === 1 ? '1 video' : `${names.length} videos`;
    if (!confirm(`Delete ${noun} permanently from the server?\n\n${names.join('\n')}`)) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting…';

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
      // Remove deleted cards from DOM
      data.deleted.forEach(name => {
        const cb = listEl.querySelector(`.manage-checkbox[data-name="${CSS.escape(name)}"]`);
        if (cb) {
          const li = cb.closest('li.manage-card');
          if (li) {
            allCards = allCards.filter(c => c !== li);
            li.remove();
          }
        }
      });
      if (data.errors && data.errors.length) {
        alert('Some deletions failed:\n' + data.errors.join('\n'));
      }
      applySortAndFilter();
    } finally {
      deleteBtn.textContent = 'Delete Selected';
      updateActionBar();
    }
  });

  // ── Merge dialog ────────────────────────────────────────────────────────────
  const mergeOverlay    = document.getElementById('merge-dialog-overlay');
  const mergeDesc       = document.getElementById('merge-dialog-desc');
  const mergeName       = document.getElementById('merge-friendly-name');
  const mergeDeleteOrig = document.getElementById('merge-delete-originals');
  const mergeCancelBtn  = document.getElementById('merge-cancel-btn');
  const mergeConfirmBtn = document.getElementById('merge-confirm-btn');

  const progressOverlay = document.getElementById('merge-progress-overlay');
  const progressMsg     = document.getElementById('merge-progress-msg');
  const progressBar     = document.getElementById('merge-progress-bar');
  const progressActions = document.getElementById('merge-progress-actions');
  const mergeDoneBtn    = document.getElementById('merge-done-btn');

  mergeBtn.addEventListener('click', function () {
    const names = getChecked();
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

  mergeConfirmBtn.addEventListener('click', async function () {
    const names = getChecked();
    const friendlyName = mergeName.value.trim();
    const deleteSources = !!mergeDeleteOrig.checked;
    mergeOverlay.style.display = 'none';

    // Show progress overlay
    progressMsg.textContent = 'Starting merge…';
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

      const jobId = data.job_id;
      pollMergeJob(jobId);
    } catch (err) {
      progressMsg.textContent = 'Network error: ' + err.message;
      progressBar.classList.add('merge-progress-bar--error');
      progressActions.style.display = '';
    }
  });

  function pollMergeJob(jobId) {
    const interval = setInterval(async function () {
      try {
        const res = await fetch(`/api/videos/merge/${jobId}`);
        const job = await res.json();

        progressMsg.textContent = job.message || '';
        progressBar.style.width = (job.percent || 0) + '%';

        if (job.status === 'success') {
          clearInterval(interval);
          progressBar.classList.add('merge-progress-bar--success');
          progressMsg.textContent = `Merge complete → ${job.output_name}`;
          progressActions.style.display = '';
          // Reload to show the new merged video
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
        // network blip – keep polling
      }
    }, 1500);
  }

  mergeDoneBtn.addEventListener('click', function () {
    progressOverlay.style.display = 'none';
  });

  // Close overlay on backdrop click
  mergeOverlay.addEventListener('click', function (e) {
    if (e.target === mergeOverlay) mergeOverlay.style.display = 'none';
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    allCards = Array.from(listEl.querySelectorAll('li.manage-card'));
    applySortAndFilter();
  }

  init();
})();
