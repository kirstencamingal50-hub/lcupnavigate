document.addEventListener('DOMContentLoaded',async()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatDate=value=>{if(!value)return '';const parsed=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?`${value}T00:00:00`:value);return Number.isNaN(parsed.getTime())?'':new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(parsed);};
  const announcementDate=item=>item.event_start?`Event: ${formatDate(item.event_start)}${item.event_end?` – ${formatDate(item.event_end)}`:''}`:formatDate(item.createdAt)?`Posted: ${formatDate(item.createdAt)}`:'';
  document.getElementById('home-search')?.addEventListener('submit',event=>{
    event.preventDefault();
    const query=document.getElementById('home-search-input')?.value.trim();
    if(query)location.href=`pages/map.html?search=${encodeURIComponent(query)}`;
  });
  const categoryRoot=document.getElementById('home-category-links'),updates=document.getElementById('home-announcements');
  try{
    const [directory,announcements]=await Promise.all([CampusApi.get('directory'),CampusApi.get('announcements')]);
    const homeCategories=[
      {name:'Academic',icon:'school'},
      {name:'Administrative',icon:'badge'},
      {name:'Medical',icon:'medical_services'},
      {name:'Events and Conference',icon:'event'},
      {name:'Food and Dining',icon:'restaurant'},
      {name:'Sports and Recreation',icon:'sports_soccer'},
      {name:'Outdoor',icon:'park'}
    ];
    if(categoryRoot)categoryRoot.innerHTML=homeCategories.map(item=>{
      const category=item.name.toLocaleLowerCase();
      const total=[...(directory.locations||[]),...(directory.rooms||[])].filter(record=>String(record.category||'').toLocaleLowerCase()===category).length;
      const label=total===1?'1 campus place':`${total} campus places`;
      const href=`pages/directory.html?category=${encodeURIComponent(item.name)}`;
      return `<a class="home-category-card" href="${href}"><span class="home-category-icon"><span class="material-symbols-rounded" aria-hidden="true">${item.icon}</span></span><span class="home-category-copy"><strong>${esc(item.name)}</strong><small>${esc(label)}</small></span><span class="material-symbols-rounded home-category-arrow" aria-hidden="true">arrow_forward</span></a>`;
    }).join('');
    if(updates)updates.innerHTML=announcements.length?announcements.slice(0,4).map(item=>`<a href="pages/announcements.html" class="home-announcement ${Number(item.pinned)?'home-announcement--pinned':'home-announcement--standard'}">${item.photo?`<img src="${esc(item.photo)}" alt="" loading="lazy">`:''}<span class="home-announcement-copy"><span class="home-announcement-label">${Number(item.pinned)?'Pinned announcement':'Campus update'}</span><strong>${esc(item.title)}</strong><span>${esc(item.details)}</span>${announcementDate(item)?`<small>${esc(announcementDate(item))}</small>`:''}${item.location?`<small>Location: ${esc(item.location)}</small>`:''}</span></a>`).join(''):'<p class="text-sm text-slate-500">There are no published announcements or events.</p>';
    const count=document.getElementById('home-directory-count');if(count)count.textContent=`${directory.locations.length} locations · ${directory.rooms.length} rooms`;
  }catch(error){if(categoryRoot)categoryRoot.innerHTML=`<p class="text-sm text-red-600">${esc(error.message)}</p>`;if(updates)updates.innerHTML=`<p class="text-sm text-red-600">Campus updates unavailable. <button onclick="location.reload()" class="underline">Retry</button></p>`;}
});
