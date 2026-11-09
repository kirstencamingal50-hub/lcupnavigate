document.addEventListener('DOMContentLoaded', async () => {
  const form=document.getElementById('announcement-form'),list=document.getElementById('admin-announcement-list'),status=document.getElementById('announcement-form-status');
  if(!form||!list)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const localDate=value=>value?String(value).replace(' ','T').slice(0,16):'';
  let items=[],editingId=null,editingPhoto=null,query='',formDialog=null,statusFilter='',page=0;
  const pageSize=10;
  const notify=(message,tone='success')=>window.AdminUI?.toast(message,tone);
  const render=()=>{
    const filtered=items.filter(item=>`${item.title} ${item.details} ${item.status}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())&&(!statusFilter||item.status===statusFilter));
    const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.max(0,Math.min(page,pageCount-1));
    const rows=filtered.slice(page*pageSize,(page+1)*pageSize);
    list.innerHTML=`<div class="admin-list-toolbar"><div><h2>Announcements and events</h2><p>${filtered.length} of ${items.length} record${items.length===1?'':'s'}</p></div><div class="admin-list-controls"><label class="admin-search"><span class="material-symbols-rounded" aria-hidden="true">search</span><span class="sr-only">Search announcements and events</span><input id="announcement-search" type="search" value="${esc(query)}" placeholder="Search by title or details"></label><label class="admin-filter-label">Status<select id="announcement-status-filter"><option value="">All statuses</option><option value="draft" ${statusFilter==='draft'?'selected':''}>Draft</option><option value="published" ${statusFilter==='published'?'selected':''}>Published</option><option value="unpublished" ${statusFilter==='unpublished'?'selected':''}>Unpublished</option></select></label></div></div>`+
      (rows.length?rows.map(item=>`<article class="admin-announcement-card" data-id="${esc(item.id)}">
        ${item.photo?`<img src="../../${esc(item.photo)}" alt="" loading="lazy">`:'<div class="admin-announcement-placeholder"><span class="material-symbols-rounded" aria-hidden="true">campaign</span></div>'}
        <div class="admin-announcement-content"><div class="admin-announcement-title"><h3>${esc(item.title)}</h3><span class="admin-status ${item.status==='published'?'is-positive':'is-neutral'}">${item.status==='published'?'Published':item.status==='draft'?'Draft':'Unpublished'}</span>${Number(item.pinned)?'<span class="admin-featured-label">Featured</span>':''}</div>
          <p>${esc(item.details)}</p>${item.event_start?`<small class="admin-announcement-meta">Event: ${esc(new Date(String(item.event_start).replace(' ','T')).toLocaleString())}${item.event_end?` – ${esc(new Date(String(item.event_end).replace(' ','T')).toLocaleString())}`:''}</small>`:''}
          <div class="admin-announcement-actions"><button data-action="preview" data-id="${esc(item.id)}" class="admin-row-action">Preview</button><button data-action="edit" data-id="${esc(item.id)}" class="admin-row-action" aria-label="Edit ${esc(item.title)}">Edit</button><button data-action="publish" data-id="${esc(item.id)}" class="admin-row-action" aria-label="${item.status==='published'?'Unpublish':'Publish'} ${esc(item.title)}">${item.status==='published'?'Unpublish':'Publish'}</button><button data-action="feature" data-id="${esc(item.id)}" class="admin-row-action">${Number(item.pinned)?'Unfeature':'Feature'}</button><button data-action="delete" data-id="${esc(item.id)}" class="admin-row-action is-danger">Delete</button></div>
        </div></article>`).join(''):`<p class="admin-empty-state">${items.length?'No records match these filters.':'No announcements or events have been added yet.'}</p>`)+
      (filtered.length>pageSize?`<nav class="admin-pagination" aria-label="Announcement pages"><span>Showing ${page*pageSize+1}–${Math.min(filtered.length,(page+1)*pageSize)} of ${filtered.length}</span><div><button type="button" data-page="previous" ${page===0?'disabled':''}>Previous</button><button type="button" data-page="next" ${page>=pageCount-1?'disabled':''}>Next</button></div></nav>`:'');
    list.querySelector('#announcement-search').addEventListener('input',event=>{const cursor=event.target.selectionStart;query=event.target.value;page=0;render();const input=list.querySelector('#announcement-search');input.focus();input.setSelectionRange(cursor,cursor);});
    list.querySelector('#announcement-status-filter').addEventListener('change',event=>{statusFilter=event.target.value;page=0;render();});
    list.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>{page+=button.dataset.page==='next'?1:-1;render();}));
  };
  const setEditing=item=>{
    editingId=item?.id??null;editingPhoto=item?.photo??null;
    form.elements.title.value=item?.title||'';form.elements.details.value=item?.details||'';
    form.elements.status.value=item?.status||'draft';form.elements.pinned.checked=!!Number(item?.pinned||0);
    form.elements.location_id.value=item?.location_id?String(item.location_id):'';
    form.elements.publish_at.value=localDate(item?.publish_at);form.elements.event_start.value=localDate(item?.event_start);form.elements.event_end.value=localDate(item?.event_end);
    form.elements.photo.value='';const preview=form.querySelector('[data-photo-preview]');if(preview){preview.hidden=!editingPhoto;preview.src=editingPhoto?`../../${editingPhoto}`:'';}
    form.querySelector('[type="submit"]').textContent=editingId?'Save announcement changes':'Save announcement';
    formDialog?.setTitle(editingId?'Edit announcement or event':'Create an announcement or event',editingId?'Update the announcement, event details, image, and publication status.':'Create a campus announcement or schedule an event.');
  };
  try{
    const [all,directory]=await Promise.all([CampusApi.get('announcements?admin=1'),CampusApi.get('directory')]);
    items=all;const select=form.elements.location_id;
    if(select)select.innerHTML='<option value="">No location</option>'+(directory.locations||[]).map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  }catch(error){status.textContent=error.message;list.innerHTML=`<p class="admin-inline-error" role="alert">${esc(error.message)}</p>`;return;}
  formDialog=window.AdminUI?.mountFormDialog(form,{title:'Create an announcement or event',description:'Create a campus announcement or schedule an event.',triggerLabel:'Create announcement'});
  formDialog?.onDismiss(()=>setEditing(null));
  window.CampusPhotoTools?.bindPreview(form.elements.photo,form.querySelector('[data-photo-preview]'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const wasEditing=Boolean(editingId);
    const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent='Saving…';
    try{
      let image_path=editingPhoto;const file=form.elements.photo.files?.[0];
      if(file){const data=new FormData();data.append('file',file);data.append('type','photo');image_path=(await CampusApi.request('uploads',{method:'POST',body:data})).path;}
      const payload={title:form.elements.title.value.trim(),details:form.elements.details.value.trim(),status:form.elements.status.value,pinned:form.elements.pinned.checked,location_id:form.elements.location_id.value||null,publish_at:form.elements.publish_at.value||null,event_start:form.elements.event_start.value||null,event_end:form.elements.event_end.value||null,image_path};
      await CampusApi.save('announcements',payload,editingId);items=await CampusApi.get('announcements?admin=1');setEditing(null);formDialog?.close();status.textContent='Saved to the campus database.';notify(wasEditing?'Announcement updated successfully.':'Announcement saved successfully.');render();
    }catch(error){status.textContent=error.message;notify(error.message,'error');}finally{button.disabled=false;}
  });
  const previewItem=(item,allowPublish=false)=>new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='admin-announcement-preview';
    const header=document.createElement('header');header.className='admin-create-dialog-heading';
    const heading=document.createElement('h2');heading.textContent=allowPublish?'Preview before publishing':'Announcement preview';
    const subtitle=document.createElement('p');subtitle.textContent=allowPublish?'Review how this announcement will appear before it goes live.':'Preview the saved announcement content.';
    const close=document.createElement('button');close.type='button';close.className='admin-icon-button';close.setAttribute('aria-label','Close preview');close.innerHTML='<span class="material-symbols-rounded" aria-hidden="true">close</span>';
    header.append(heading,subtitle,close);
    const content=document.createElement('article');content.className='admin-announcement-preview-content';
    if(item.photo){const image=document.createElement('img');image.src=`../../${item.photo}`;image.alt='';content.append(image);}
    const title=document.createElement('h3');title.textContent=item.title;content.append(title);
    const details=document.createElement('p');details.textContent=item.details;content.append(details);
    if(item.event_start){const date=document.createElement('p');date.className='admin-announcement-meta';date.textContent=`Event: ${new Date(String(item.event_start).replace(' ','T')).toLocaleString()}${item.event_end?` to ${new Date(String(item.event_end).replace(' ','T')).toLocaleString()}`:''}`;content.append(date);}
    const actions=document.createElement('div');actions.className='admin-dialog-actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.className='admin-button-secondary';cancel.textContent='Close preview';actions.append(cancel);
    if(allowPublish){const publish=document.createElement('button');publish.type='button';publish.className='admin-button-primary';publish.textContent='Publish announcement';actions.append(publish);publish.addEventListener('click',()=>finish(true));}
    dialog.append(header,content,actions);document.body.append(dialog);let settled=false;
    const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};
    close.addEventListener('click',()=>finish(false));cancel.addEventListener('click',()=>finish(false));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});dialog.addEventListener('click',event=>{if(event.target===dialog)finish(false);});dialog.showModal();
  });
  list.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button)return;const item=items.find(record=>String(record.id)===button.dataset.id);if(!item)return;
    if(button.dataset.action==='preview'){await previewItem(item);return;}
    if(button.dataset.action==='edit'){setEditing(item);status.textContent='Edit the fields, then save your changes.';formDialog?.open();form.elements.title.focus();return;}
    if(button.dataset.action==='delete'&&!await window.AdminUI.confirm({title:'Delete announcement?',message:`Delete “${item.title}”? This permanently removes the announcement and its link from the public site.`,confirmLabel:'Delete announcement',danger:true}))return;
    if(button.dataset.action==='publish'&&item.status!=='published'&&!await previewItem(item,true))return;
    button.disabled=true;
    try{
      if(button.dataset.action==='delete')await CampusApi.remove('announcements',item.id);
      else if(button.dataset.action==='publish')await CampusApi.save('announcements',{title:item.title,details:item.details,status:item.status==='published'?'unpublished':'published',pinned:Boolean(Number(item.pinned)),location_id:item.location_id,publish_at:item.publish_at,event_start:item.event_start,event_end:item.event_end,image_path:item.photo},item.id);
      else if(button.dataset.action==='feature')await CampusApi.save('announcements',{title:item.title,details:item.details,status:item.status,pinned:!Number(item.pinned),location_id:item.location_id,publish_at:item.publish_at,event_start:item.event_start,event_end:item.event_end,image_path:item.photo},item.id);
      items=await CampusApi.get('announcements?admin=1');status.textContent='Announcement updated.';notify(button.dataset.action==='delete'?'Announcement deleted.':button.dataset.action==='publish'?(item.status==='published'?'Announcement unpublished.':'Announcement published.'):'Announcement updated.');render();
    }catch(error){status.textContent=error.message;notify(error.message,'error');}finally{button.disabled=false;}
  });
  setEditing(null);render();
});
