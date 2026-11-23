document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('directory-list');
  const search = document.getElementById('directory-search');
  const count = document.getElementById('directory-count');
  const sort = document.getElementById('directory-sort');
  const filterGroup = document.getElementById('directory-filters');
  if (!container || !search || !count || !sort || !filterGroup) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const mediaSrc = value => {
    const path = String(value || '');
    if (!path) return '';
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    return path.startsWith('/') ? path : `../${path.replace(/^\.\//, '')}`;
  };
  const featureLabels = {
    wheelchair_entrance: 'Wheelchair-accessible entrance',
    elevator: 'Elevator',
    ramp: 'Ramp',
    accessible_restroom: 'Accessible restroom',
    accessible_parking: 'Accessible parking',
    handrails: 'Handrails',
    tactile_paving: 'Tactile paving',
    braille_signage: 'Braille signage',
    hearing_assistance: 'Hearing assistance'
  };
  const params = new URLSearchParams(location.search);
  let category = params.get('category') || '';
  const requestedKind = params.get('type') || '';
  let selectedKind = ['building', 'facility', 'room'].includes(requestedKind) ? requestedKind : 'all';
  let records = [];
  const normalizeCategory = value => String(value ?? '').toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\\/–—_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const categoryAliases = {
    academic: ['academic', 'academic building'],
    administrative: ['administrative', 'administration', 'administrative building', 'office'],
    medical: ['medical', 'health and medical', 'health'],
    'events and conference': ['events and conference', 'event and conference', 'events conference', 'events'],
    'food and dining': ['food and dining', 'food', 'dining'],
    'sports and recreation': ['sports and recreation', 'recreation and sports', 'sports', 'recreation'],
    outdoor: ['outdoor', 'outdoor spaces']
  };
  const selectedAliases = Object.entries(categoryAliases).find(([key, aliases]) =>
    normalizeCategory(key) === normalizeCategory(category) ||
    aliases.some(alias => normalizeCategory(alias) === normalizeCategory(category))
  )?.[1] || null;

  function render() {
    container.querySelectorAll('.directory-card').forEach(card=>clearInterval(card._photoTimer));
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = records.filter(item => {
      const text = `${item.name} ${item.category || ''} ${item.description || ''} ${item.parent_building || ''} ${item.room_number || ''} ${item.services || ''}`.toLocaleLowerCase();
      const itemCategories = (Array.isArray(item.category_names) && item.category_names.length ? item.category_names : [item.category]).filter(Boolean).map(normalizeCategory);
      const categoryMatch = !category || category === 'all' ||
        (selectedAliases
          ? itemCategories.some(itemCategory => selectedAliases.some(alias => itemCategory.includes(normalizeCategory(alias)) || normalizeCategory(alias).includes(itemCategory)))
          : itemCategories.some(itemCategory => itemCategory.includes(normalizeCategory(category))) || normalizeCategory(item.kind).includes(normalizeCategory(category)));
      return (!query || text.includes(query)) && categoryMatch && (selectedKind === 'all' || item.kind === selectedKind);
    });
    if (sort.value === 'name-desc') filtered.sort((a, b) => String(b.name).localeCompare(String(a.name)));
    else if (sort.value === 'type') filtered.sort((a, b) => a.kind.localeCompare(b.kind) || String(a.name).localeCompare(String(b.name)));
    else filtered.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    count.textContent = `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}`;
    if (!filtered.length) {
      const kindLabel = selectedKind === 'building' ? 'buildings' : selectedKind === 'facility' ? 'facilities' : selectedKind === 'room' ? 'rooms' : 'campus places';
      const message = query
        ? 'Try another search or clear your search to see more places.'
        : category
          ? `No active campus places are assigned to “${escapeHtml(category)}” yet. Clear the category filter to browse all places.`
          : selectedKind !== 'all'
            ? `There are no ${kindLabel} in the directory yet.`
            : 'Try another search or choose a different directory filter.';
      container.innerHTML = `<div class="directory-empty"><span class="material-symbols-rounded" aria-hidden="true">search_off</span><h2>No matches found</h2><p>${message}</p>${category?'<button type="button" data-clear-category>Browse all places</button>':''}</div>`;
      container.querySelector('[data-clear-category]')?.addEventListener('click', () => document.getElementById('clear-directory-category')?.click());
      return;
    }
    container.innerHTML = filtered.map(item => {
      const kindLabel = item.kind === 'room' ? 'Room' : item.kind === 'building' ? 'Building' : 'Facility';
      const detailUrl = item.kind === 'room' ? `office.html?id=${encodeURIComponent(item.id)}` : `building.html?id=${encodeURIComponent(item.id)}`;
      const photoList = Array.isArray(item.photos) ? item.photos.filter(photo => photo?.image) : [];
      const coverPhoto = photoList.find(photo => Number(photo.isCover)) || photoList[0] || null;
      const image = coverPhoto?.image || item.image || '';
      const slideshowPhotos = coverPhoto ? [coverPhoto,...photoList.filter(photo=>photo!==coverPhoto)] : (photoList.length ? photoList : (image ? [{image,caption:''}] : []));
      const photoSlides = slideshowPhotos.map((photo,index) => `<img class="directory-card-photo${index===0?' is-active':''}" src="${escapeHtml(mediaSrc(photo.image))}" alt="" loading="${index===0?'eager':'lazy'}" decoding="async" data-directory-slide="${index}" ${index===0?'':'hidden'}>`).join('');
      const features = item.kind === 'building' && Array.isArray(item.accessibilityFeatures)
        ? item.accessibilityFeatures.filter(feature => featureLabels[feature]).map(feature => `<span class="directory-feature"><span class="material-symbols-rounded" aria-hidden="true">accessible</span>${escapeHtml(featureLabels[feature])}</span>`).join('')
        : '';
      return `<article class="directory-card">
        <div class="directory-card-name" style="${image && !photoSlides ? `background-image:url('${escapeHtml(mediaSrc(image))}')` : ''}">
          <a class="directory-card-name-link" href="${detailUrl}" aria-label="View ${escapeHtml(item.name)}">
            <span class="directory-card-name-fallback material-symbols-rounded" aria-hidden="true">${item.kind === 'room' ? 'meeting_room' : item.kind === 'building' ? 'location_city' : 'storefront'}</span>
            ${photoSlides}
            <span class="directory-card-meta"><span class="directory-kind">${kindLabel}</span><span>${escapeHtml((item.category_names?.length ? item.category_names : [item.category]).filter(Boolean).join(' · ') || 'Campus')}</span></span>
            <strong>${escapeHtml(item.name)}</strong>
          </a>
          ${slideshowPhotos.length>1 ? `<div class="directory-photo-controls" aria-label="Photo slideshow"><button type="button" data-photo-prev aria-label="Previous photo">‹</button><span data-photo-count>1 / ${slideshowPhotos.length}</span><button type="button" data-photo-next aria-label="Next photo">›</button></div>` : ''}
        </div>
        <div class="directory-card-body">
          <p class="directory-card-description">${escapeHtml(item.description || 'More information is available in this directory profile.')}</p>
          ${item.parent_building ? `<p class="directory-parent"><span class="material-symbols-rounded" aria-hidden="true">location_on</span>${escapeHtml(item.parent_building)}${item.room_number ? ` · Room ${escapeHtml(item.room_number)}` : ''}</p>` : ''}
          ${features ? `<div class="directory-features" aria-label="Building accessibility features">${features}</div>` : ''}
        </div>
        <div class="directory-card-actions"><a href="map.html?search=${encodeURIComponent(item.name)}"><span class="material-symbols-rounded" aria-hidden="true">map</span>Show on map</a><a href="${detailUrl}" aria-label="View details for ${escapeHtml(item.name)}">Details<span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></a></div>
      </article>`;
    }).join('');
    container.querySelectorAll('.directory-card').forEach(card => {
      const slides=[...card.querySelectorAll('[data-directory-slide]')];
      if(!slides.length)return;
      let current=0;
      const show=index=>{
        current=(index+slides.length)%slides.length;
        slides.forEach((slide,i)=>{slide.hidden=i!==current;slide.classList.toggle('is-active',i===current);});
        const counter=card.querySelector('[data-photo-count]');
        if(counter)counter.textContent=`${current+1} / ${slides.length}`;
      };
      card.querySelector('[data-photo-prev]')?.addEventListener('click',()=>show(current-1));
      card.querySelector('[data-photo-next]')?.addEventListener('click',()=>show(current+1));
      if(slides.length>1)card._photoTimer=setInterval(()=>show(current+1),4500);
      slides.forEach(photo=>photo.addEventListener('error',()=>{photo.hidden=true;}, {once:true}));
    });
  }

  container.innerHTML = '<p class="directory-loading" role="status">Loading campus directory…</p>';
  try {
    const data = await window.CampusApi.get('directory');
    const locations = data.locations || [];
    const rooms = data.rooms || [];
    records = [...locations, ...rooms.map(room => {
      const parent = locations.find(place => String(place.id) === String(room.buildingId));
      const roomPhotos = Array.isArray(room.photos) && room.photos.length ? room.photos : (parent?.photos || []);
      return {
        ...room,
        kind: 'room',
        parent_building: room.buildingName || parent?.name || '',
        room_number: room.roomNumber,
        image: room.image || parent?.image || '',
        photos: roomPhotos,
        model_3d_url: room.model_3d_url || ''
      };
    })];
    window.dispatchEvent(new CustomEvent('campusDataReady', {detail: data}));
    render();
    search.addEventListener('input', render);
    sort.addEventListener('change', render);
    const categoryFilter = document.getElementById('directory-category-filter');
    const categoryLabel = document.getElementById('directory-category-label');
    const updateCategoryNotice = () => {
      const hasCategory = Boolean(category && category !== 'all');
      const hasKind = selectedKind !== 'all';
      categoryFilter.hidden = !hasCategory && !hasKind;
      categoryLabel.textContent = [hasCategory ? `Category: ${category}` : '', hasKind ? `Type: ${selectedKind === 'room' ? 'Rooms' : selectedKind === 'building' ? 'Buildings' : 'Facilities'}` : ''].filter(Boolean).join(' · ');
    };
    filterGroup.querySelectorAll('[data-directory-kind]').forEach(filter => filter.setAttribute('aria-pressed', String(filter.dataset.directoryKind === selectedKind)));
    updateCategoryNotice();
    document.getElementById('clear-directory-category')?.addEventListener('click', () => {
      category = '';
      params.delete('category');
      selectedKind = 'all';
      params.delete('type');
      filterGroup.querySelectorAll('[data-directory-kind]').forEach(filter => filter.setAttribute('aria-pressed', String(filter.dataset.directoryKind === selectedKind)));
      const query = params.toString();
      history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
      updateCategoryNotice();
      render();
    });
    filterGroup.addEventListener('click', event => {
      const button = event.target.closest('[data-directory-kind]');
      if (!button) return;
      selectedKind = button.dataset.directoryKind;
      if (selectedKind === 'all') params.delete('type');
      else params.set('type', selectedKind);
      filterGroup.querySelectorAll('[data-directory-kind]').forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
      const query = params.toString();
      history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
      updateCategoryNotice();
      render();
    });
  } catch (error) {
    count.textContent = 'Directory unavailable';
    container.innerHTML = `<div class="directory-empty"><span class="material-symbols-rounded" aria-hidden="true">error</span><h2>Could not load directory</h2><p>${escapeHtml(error.message)}</p><button type="button" id="retry-directory">Try again</button></div>`;
    container.querySelector('#retry-directory')?.addEventListener('click', () => location.reload());
  }
});
