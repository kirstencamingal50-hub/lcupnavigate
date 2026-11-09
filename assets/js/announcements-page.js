(() => {
  document.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('announcement-list');
    const dialog = document.getElementById('announcement-dialog');
    const content = document.getElementById('announcement-dialog-content');
    if (!list || !dialog || !content) return;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const date = value => { if(!value)return '';const parsed=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?`${value}T00:00:00`:value); return Number.isNaN(parsed.getTime())?'Date unavailable':new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(parsed); };
    const eventDate = item => item.event_start ? `Event: ${date(item.event_start)}${item.event_end ? ` – ${date(item.event_end)}` : ''}` : '';
    let items = [];
    const render = () => {
      const renderCards = subset => subset.map(item => Number(item.pinned) ? `<button type="button" class="announcement-preview announcement-preview--pinned" data-id="${esc(item.id)}">
        ${item.photo ? `<img class="announcement-preview-image" src="../${esc(item.photo)}" alt="" loading="lazy" />` : '<span class="announcement-preview-image announcement-preview-image--empty material-symbols-rounded" aria-hidden="true">campaign</span>'}
        <span class="announcement-preview-copy"><span class="announcement-pin-label"><span class="material-symbols-rounded" aria-hidden="true">push_pin</span> Pinned announcement</span><strong>${esc(item.title)}</strong><span class="announcement-preview-details">${esc(item.details)}</span><span class="announcement-date">${esc(date(item.createdAt))}${eventDate(item) ? ` · ${esc(eventDate(item))}` : ''}${item.location ? ` · ${esc(item.location)}` : ''}</span><span class="announcement-preview-link">Read more <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></span></span></button>` : `<button type="button" class="announcement-preview announcement-preview--standard" data-id="${esc(item.id)}">
        ${item.photo ? `<img class="announcement-preview-image" src="../${esc(item.photo)}" alt="" loading="lazy" />` : '<span class="announcement-preview-image announcement-preview-image--empty material-symbols-rounded" aria-hidden="true">campaign</span>'}
        <span class="announcement-preview-copy"><span class="announcement-date">${esc(date(item.createdAt))}</span><strong>${esc(item.title)}</strong><span class="announcement-preview-details">${esc(item.details)}</span>${eventDate(item) ? `<span class="announcement-date">${esc(eventDate(item))}</span>` : ''}${item.location ? `<span class="announcement-date">Location: ${esc(item.location)}</span>` : ''}<span class="announcement-preview-link">Read announcement <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></span></span></button>`).join('');
      const featured=items.filter(item=>Number(item.pinned)), regular=items.filter(item=>!Number(item.pinned));
      list.innerHTML = items.length ? `${featured.length ? `<section class="announcement-group announcement-group--pinned"><div class="announcement-group-heading"><h2><span class="material-symbols-rounded" aria-hidden="true">push_pin</span> Featured Announcements</h2><span>${featured.length}</span></div><div class="announcement-list announcement-group-list">${renderCards(featured)}</div></section>`:''}${regular.length ? `<section class="announcement-group announcement-group--regular"><div class="announcement-group-heading"><h2>More Announcements</h2><span>${regular.length}</span></div><div class="announcement-list announcement-group-list">${renderCards(regular)}</div></section>`:''}` : '<p class="announcement-empty">No published announcements are available.</p>';
    };
    list.innerHTML='<p class="announcement-empty" role="status">Loading announcements…</p>';
    try { items=await window.CampusApi.get('announcements');render(); }
    catch(error){list.innerHTML=`<div class="announcement-empty"><p>${esc(error.message)}</p><button id="retry-announcements" type="button" class="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white">Retry</button></div>`;list.querySelector('#retry-announcements')?.addEventListener('click',()=>location.reload());}
    list.addEventListener('click',event=>{
      const card=event.target.closest('[data-id]');if(!card)return;
      const item=items.find(entry=>String(entry.id)===card.dataset.id);if(!item)return;
      content.innerHTML=`${item.photo?`<img class="announcement-detail-image" src="../${esc(item.photo)}" alt="Announcement image for ${esc(item.title)}" />`:''}<p class="announcement-date">${esc(date(item.createdAt))}</p><h2 id="announcement-dialog-title">${esc(item.title)}</h2><p class="announcement-detail-text">${esc(item.details)}</p>${item.location?`<p>Location: ${esc(item.location)}</p>`:''}${item.event_start?`<p>Event: ${esc(date(item.event_start))}${item.event_end?` – ${esc(date(item.event_end))}`:''}</p>`:''}`;
      dialog.showModal();
    });
    dialog.querySelector('.announcement-dialog-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>content.replaceChildren());
  });
})();
