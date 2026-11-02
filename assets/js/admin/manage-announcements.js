document.addEventListener('DOMContentLoaded', async () => {
  const form=document.getElementById('announcement-form'),list=document.getElementById('admin-announcement-list'),status=document.getElementById('announcement-form-status');
  if(!form||!list)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const localDate=value=>value?String(value).replace(' ','T').slice(0,16):'';
  let items=[],editingId=null,editingPhoto=null,query='';
  const render=()=>{
    const rows=items.filter(item=>`${item.title} ${item.details} ${item.status}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    list.innerHTML=`<div class="admin-list-toolbar"><div><h2>Announcements and events</h2><p>${rows.length} of ${items.length} record${items.length===1?'':'s'}</p></div><label class="admin-search"><span class="material-symbols-rounded" aria-hidden="true">search</span><span class="sr-only">Search announcements and events</span><input id="announcement-search" type="search" value="${esc(query)}" placeholder="Search by title, details or status"></label></div>`+
      (rows.length?rows.map(item=>`<article class="admin-announcement-card" data-id="${esc(item.id)}">
        ${item.photo?`<img src="../../${esc(item.photo)}" alt="" loading="lazy">`:'<div class="admin-announcement-placeholder"><span class="material-symbols-rounded" aria-hidden="true">campaign</span></div>'}
        <div class="admin-announcement-content"><div class="admin-announcement-title"><h3>${esc(item.title)}</h3><span class="admin-status ${item.status==='published'?'is-positive':'is-neutral'}">${item.status==='published'?'Published':item.status==='draft'?'Draft':'Unpublished'}</span>${Number(item.pinned)?'<span class="admin-featured-label">Featured</span>':''}</div>
          <p>${esc(item.details)}</p>${item.event_start?`<small class="admin-announcement-meta">Event: ${esc(new Date(String(item.event_start).replace(' ','T')).toLocaleString())}${item.event_end?` – ${esc(new Date(String(item.event_end).replace(' ','T')).toLocaleString())}`:''}</small>`:''}
          <div class="admin-announcement-actions"><button data-action="edit" data-id="${esc(item.id)}" class="admin-row-action" aria-label="Edit ${esc(item.title)}">Edit</button><button data-action="publish" data-id="${esc(item.id)}" class="admin-row-action" aria-label="${item.status==='published'?'Unpublish':'Publish'} ${esc(item.title)}">${item.status==='published'?'Unpublish':'Publish'}</button><button data-action="feature" data-id="${esc(item.id)}" class="admin-row-action">${Number(item.pinned)?'Unfeature':'Feature'}</button><button data-action="delete" data-id="${esc(item.id)}" class="admin-row-action is-danger">Delete</button></div>
        </div></article>`).join(''):`<p class="admin-empty-state">${items.length?'No records match this search.':'No announcements or events have been added yet.'}</p>`);
    list.querySelector('#announcement-search').addEventListener('input',event=>{const cursor=event.target.selectionStart;query=event.target.value;render();const input=list.querySelector('#announcement-search');input.focus();input.setSelectionRange(cursor,cursor);});
  };
  const setEditing=item=>{
    editingId=item?.id??null;editingPhoto=item?.photo??null;
    form.elements.title.value=item?.title||'';form.elements.details.value=item?.details||'';
    form.elements.status.value=item?.status||'draft';form.elements.pinned.checked=!!Number(item?.pinned||0);
    form.elements.location_id.value=item?.location_id?String(item.location_id):'';
    form.elements.publish_at.value=localDate(item?.publish_at);form.elements.event_start.value=localDate(item?.event_start);form.elements.event_end.value=localDate(item?.event_end);
    form.elements.photo.value='';const preview=form.querySelector('[data-photo-preview]');if(preview){preview.hidden=!editingPhoto;preview.src=editingPhoto?`../../${editingPhoto}`:'';}
    form.querySelector('[type="submit"]').textContent=editingId?'Save announcement changes':'Save announcement';
    document.getElementById('cancel-announcement-edit').hidden=!editingId;
    document.getElementById('add-announcement-title').textContent=editingId?'Edit announcement or event':'Create an announcement or event';
  };
  try{
    const [all,directory]=await Promise.all([CampusApi.get('announcements?admin=1'),CampusApi.get('directory')]);
    items=all;const select=form.elements.location_id;
    if(select)select.innerHTML='<option value="">No location</option>'+(directory.locations||[]).map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  }catch(error){status.textContent=error.message;list.innerHTML=`<p class="admin-inline-error" role="alert">${esc(error.message)}</p>`;return;}
  window.CampusPhotoTools?.bindPreview(form.elements.photo,form.querySelector('[data-photo-preview]'));
  document.getElementById('cancel-announcement-edit').addEventListener('click',()=>{setEditing(null);status.textContent='Editing cancelled.';});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent='Saving…';
    try{
      let image_path=editingPhoto;const file=form.elements.photo.files?.[0];
      if(file){const data=new FormData();data.append('file',file);data.append('type','photo');image_path=(await CampusApi.request('uploads',{method:'POST',body:data})).path;}
      const payload={title:form.elements.title.value.trim(),details:form.elements.details.value.trim(),status:form.elements.status.value,pinned:form.elements.pinned.checked,location_id:form.elements.location_id.value||null,publish_at:form.elements.publish_at.value||null,event_start:form.elements.event_start.value||null,event_end:form.elements.event_end.value||null,image_path};
      await CampusApi.save('announcements',payload,editingId);items=await CampusApi.get('announcements?admin=1');setEditing(null);status.textContent='Saved to the campus database.';render();
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  list.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button)return;const item=items.find(record=>String(record.id)===button.dataset.id);if(!item)return;
    if(button.dataset.action==='edit'){setEditing(item);status.textContent='Edit the fields above, then save your changes.';form.scrollIntoView({behavior:'smooth',block:'start'});form.elements.title.focus();return;}
    if(button.dataset.action==='delete'&&!confirm(`Delete “${item.title}”?`))return;
    button.disabled=true;
    try{
      if(button.dataset.action==='delete')await CampusApi.remove('announcements',item.id);
      else if(button.dataset.action==='publish')await CampusApi.save('announcements',{title:item.title,details:item.details,status:item.status==='published'?'unpublished':'published',pinned:Boolean(Number(item.pinned)),location_id:item.location_id,publish_at:item.publish_at,event_start:item.event_start,event_end:item.event_end,image_path:item.photo},item.id);
      else if(button.dataset.action==='feature')await CampusApi.save('announcements',{title:item.title,details:item.details,status:item.status,pinned:!Number(item.pinned),location_id:item.location_id,publish_at:item.publish_at,event_start:item.event_start,event_end:item.event_end,image_path:item.photo},item.id);
      items=await CampusApi.get('announcements?admin=1');status.textContent='Announcement updated.';render();
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  setEditing(null);render();
});
