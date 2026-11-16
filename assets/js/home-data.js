document.addEventListener('DOMContentLoaded', async () => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const normalize = value => String(value ?? '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\\/–—_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\\s+/g, ' ')
    .trim();
  const formatDate = value => {
    if (!value) return '';
    const parsed = new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(value) ? `${value}T00:00:00` : value);
    return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed);
  };
  const announcementDate = item => item.event_start
    ? `Event: ${formatDate(item.event_start)}${item.event_end ? ` – ${formatDate(item.event_end)}` : ''}`
    : formatDate(item.createdAt) ? `Posted: ${formatDate(item.createdAt)}` : '';

  document.getElementById('home-search')?.addEventListener('submit', event => {
    event.preventDefault();
    const query = document.getElementById('home-search-input')?.value.trim();
    if (query) location.href = `pages/map.html?search=${encodeURIComponent(query)}`;
  });

  const categoryRoot = document.getElementById('home-category-links');
  const updates = document.getElementById('home-announcements');
  const homeCategories = [
    { name: 'Academic', icon: 'school', aliases: ['academic', 'academic building'] },
    { name: 'Administrative', icon: 'badge', aliases: ['administrative', 'administration', 'administrative building', 'office'] },
    { name: 'Medical', icon: 'medical_services', aliases: ['medical', 'health and medical', 'health'] },
    { name: 'Events and Conference', icon: 'event', aliases: ['events and conference', 'event and conference', 'events conference', 'events'] },
    { name: 'Food and Dining', icon: 'restaurant', aliases: ['food and dining', 'food', 'dining'] },
    { name: 'Sports and Recreation', icon: 'sports_soccer', aliases: ['sports and recreation', 'recreation and sports', 'sports', 'recreation'] },
    { name: 'Outdoor', icon: 'park', aliases: ['outdoor', 'outdoor spaces'] }
  ];

  try {
    const [directoryResult, announcementResult] = await Promise.allSettled([
      CampusApi.get('directory'),
      CampusApi.get('announcements')
    ]);
    const directory = directoryResult.status === 'fulfilled' ? (directoryResult.value || {}) : {};
    const announcementPayload = announcementResult.status === 'fulfilled' ? announcementResult.value : [];
    const announcements = Array.isArray(announcementPayload)
      ? announcementPayload
      : Array.isArray(announcementPayload?.announcements)
        ? announcementPayload.announcements
        : Array.isArray(announcementPayload?.items) ? announcementPayload.items : [];
    const locations = Array.isArray(directory.locations) ? directory.locations : [];
    const rooms = Array.isArray(directory.rooms) ? directory.rooms : [];
    const campusPlaces = locations.filter(record =>
      ['building', 'facility'].includes(String(record.kind || '').toLowerCase()) &&
      record.active !== false
    );

    if (categoryRoot) {
      categoryRoot.innerHTML = homeCategories.map(item => {
        const aliases = item.aliases.map(normalize);
        const matches = campusPlaces.filter(place => {
          const actual = normalize(place.category);
          return actual && aliases.some(alias =>
            actual === alias || actual.includes(alias) || alias.includes(actual)
          );
        });
        const buildingCount = matches.filter(place => String(place.kind || '').toLowerCase() === 'building').length;
        const facilityCount = matches.filter(place => String(place.kind || '').toLowerCase() === 'facility').length;
        const countLabel = [
          buildingCount ? `${buildingCount} ${buildingCount === 1 ? 'building' : 'buildings'}` : '',
          facilityCount ? `${facilityCount} ${facilityCount === 1 ? 'facility' : 'facilities'}` : ''
        ].filter(Boolean).join(' · ') || 'No places assigned yet';
        const href = `pages/directory.html?category=${encodeURIComponent(item.name)}`;
        return `<a class="home-category-card" href="${href}">
          <span class="home-category-icon"><span class="material-symbols-rounded" aria-hidden="true">${item.icon}</span></span>
          <span class="home-category-copy">
            <strong>${esc(item.name)}</strong>
            <small>${esc(countLabel)}</small>
          </span>
          <span class="material-symbols-rounded home-category-arrow" aria-hidden="true">arrow_forward</span>
        </a>`;
      }).join('');
    }

    if (updates) {
      updates.innerHTML = announcementResult.status === 'rejected'
        ? '<p class="text-sm text-red-600">Campus announcements could not be loaded. Please try again later.</p>'
        : announcements.length
          ? announcements.slice(0, 4).map(item => {
              const photo = item.photo || item.image || item.image_path;
              const details = item.details || item.body || item.description || '';
              return `<a href="pages/announcements.html" class="home-announcement ${Number(item.pinned ?? item.featured) ? 'home-announcement--pinned' : 'home-announcement--standard'}">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : ''}<span class="home-announcement-copy"><span class="home-announcement-label">${Number(item.pinned ?? item.featured) ? 'Pinned announcement' : 'Campus update'}</span><strong>${esc(item.title)}</strong><span>${esc(details)}</span>${announcementDate(item) ? `<small>${esc(announcementDate(item))}</small>` : ''}${item.location ? `<small>Location: ${esc(item.location)}</small>` : ''}</span></a>`;
            }).join('')
          : '<p class="text-sm text-slate-500">There are no published announcements or events.</p>';
    }

    const count = document.getElementById('home-directory-count');
    if (count) count.textContent = `${locations.length} locations · ${rooms.length} rooms`;
  } catch (error) {
    if (categoryRoot) categoryRoot.innerHTML = `<p class="text-sm text-red-600">${esc(error.message)}</p>`;
    if (updates) updates.innerHTML = `<p class="text-sm text-red-600">Campus updates unavailable. <button onclick="location.reload()" class="underline">Retry</button></p>`;
  }
});
