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

function applySortAndFilter(){
  const list = document.getElementById('video-list');
  const cards = Array.from(list.querySelectorAll('li[data-video-card="1"]'));
  const empty = document.getElementById('home-empty');
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

  let visibleCount = 0;
  cards.forEach(card => {
    list.appendChild(card);
    const haystack = card.dataset.search || '';
    const match = !query || haystack.includes(query);
    card.style.display = match ? '' : 'none';
    if(match) visibleCount += 1;
  });

  if(empty){
    empty.style.display = visibleCount === 0 ? '' : 'none';
  }
}

window.addEventListener('load', () => {
  updateAviCount();
  const search = document.getElementById('home-search');
  const sort = document.getElementById('home-sort');
  const order = document.getElementById('home-order');

  search.addEventListener('input', applySortAndFilter);
  sort.addEventListener('change', applySortAndFilter);
  order.addEventListener('change', applySortAndFilter);

  applySortAndFilter();
});
