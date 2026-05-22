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
let currentPage = 1;

function pageTokens(totalPages, page){
  if(totalPages <= 8){
    return Array.from({length: totalPages}, (_, i) => i + 1);
  }

  if(page <= 4){
    return [1, 2, 3, 4, 5, '...', totalPages];
  }

  if(page >= totalPages - 3){
    return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, '...', page - 1, page, page + 1, '...', totalPages];
}

function renderPageNumbers(totalPages, page){
  const container = document.getElementById('home-page-numbers');
  if(!container) return;

  container.innerHTML = '';
  const tokens = pageTokens(totalPages, page);
  tokens.forEach(token => {
    if(token === '...'){
      const dot = document.createElement('span');
      dot.className = 'ellipsis';
      dot.textContent = '...';
      container.appendChild(dot);
      return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = String(token);
    btn.dataset.page = String(token);
    if(token === page){
      btn.classList.add('is-current');
      btn.disabled = true;
    }
    container.appendChild(btn);
  });
}

function applySortAndFilter({ resetPage = false } = {}){
  const list = document.getElementById('video-list');
  const cards = Array.from(list.querySelectorAll('li[data-video-card="1"]'));
  const empty = document.getElementById('home-empty');
  const sortBy = document.getElementById('home-sort').value;
  const order = document.getElementById('home-order').value;
  const query = document.getElementById('home-search').value.trim().toLowerCase();
  const prevBtn = document.getElementById('home-prev');
  const nextBtn = document.getElementById('home-next');
  const pageInfo = document.getElementById('home-page-info');
  const pageNumbers = document.getElementById('home-page-numbers');
  const pager = document.getElementById('home-pagination');

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

  const filtered = [];
  cards.forEach(card => {
    list.appendChild(card);
    const haystack = card.dataset.search || '';
    const match = !query || haystack.includes(query);
    if(match) filtered.push(card);
  });

  if(resetPage) currentPage = 1;
  const totalResults = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));
  if(currentPage > totalPages) currentPage = totalPages;

  cards.forEach(card => {
    card.style.display = 'none';
  });

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);
  pageItems.forEach(card => {
    card.style.display = '';
  });

  if(empty){
    empty.style.display = totalResults === 0 ? '' : 'none';
  }

  if(pager && prevBtn && nextBtn && pageInfo){
    pager.style.display = cards.length > 0 ? 'flex' : 'none';
    prevBtn.disabled = totalResults === 0 || currentPage <= 1;
    nextBtn.disabled = totalResults === 0 || currentPage >= totalPages;
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} • ${totalResults} result${totalResults === 1 ? '' : 's'}`;
    if(pageNumbers){
      renderPageNumbers(totalPages, currentPage);
    }
  }
}

window.addEventListener('load', () => {
  updateAviCount();
  const search = document.getElementById('home-search');
  const sort = document.getElementById('home-sort');
  const order = document.getElementById('home-order');
  const prevBtn = document.getElementById('home-prev');
  const nextBtn = document.getElementById('home-next');
  const pageNumbers = document.getElementById('home-page-numbers');

  search.addEventListener('input', () => applySortAndFilter({ resetPage: true }));
  sort.addEventListener('change', () => applySortAndFilter({ resetPage: true }));
  order.addEventListener('change', () => applySortAndFilter({ resetPage: true }));
  prevBtn.addEventListener('click', () => {
    currentPage = Math.max(1, currentPage - 1);
    applySortAndFilter();
  });
  nextBtn.addEventListener('click', () => {
    currentPage += 1;
    applySortAndFilter();
  });
  pageNumbers.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-page]');
    if(!btn) return;
    const page = Number(btn.dataset.page || 1);
    if(Number.isNaN(page)) return;
    currentPage = Math.max(1, page);
    applySortAndFilter();
  });

  applySortAndFilter();
});
