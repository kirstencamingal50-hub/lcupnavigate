document.addEventListener('DOMContentLoaded', async () => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const categoryPage=!!document.querySelector('[data-category-form]');
  const buildingForm=document.getElementById('add-building-form');
  const facilityForm=document.getElementById('add-facility-form');
  const roomForm=document.getElementById('add-classroom-form');
  if(!categoryPage&&!buildingForm&&!facilityForm&&!roomForm)return;
  let categories=[],locations=[],rooms=[],pendingEdit=null;
  const searchTerms={building:'',facility:'',room:''};
  const refresh=async()=>{const [categoryRows,locationRows,roomRows,directory]=await Promise.all([CampusApi.get('categories'),CampusApi.get('locations'),CampusApi.get('rooms'),CampusApi.get('directory')]);categories=categoryRows;locations=locationRows.map(item=>({...item,photos:(directory.locations||[]).find(record=>String(record.id)===String(item.id))?.photos||[]}));rooms=roomRows.map(item=>({...item,photos:(directory.rooms||[]).find(record=>String(record.id)===String(item.id))?.photos||[]}));};
  const statusNode=()=>document.querySelector('#building-form-status,#facility-form-status,#classroom-form-status,#category-status');
  const status=message=>{const node=statusNode();if(node)node.textContent=message;};
  const upload=async input=>{const file=input?.files?.[0];if(!file)return null;const data=new FormData();data.append('file',file);data.append('type','photo');return(await CampusApi.request('uploads',{method:'POST',body:data})).path;};
  const optionalText=(form,name)=>form.elements[name]?.value.trim()||null;
  const detailPayload=form=>({
    department_name:optionalText(form,'department_name'),
    contact_email:optionalText(form,'contact_email'),
    contact_phone:optionalText(form,'contact_phone'),
    website_url:optionalText(form,'website_url'),
    service_hours:optionalText(form,'service_hours'),
    access_hours:optionalText(form,'access_hours'),
    days_open:optionalText(form,'days_open'),
    lunch_break:optionalText(form,'lunch_break'),
    services:optionalText(form,'services'),
    nearby_landmarks:optionalText(form,'nearby_landmarks'),
    accessibility_status:form.elements.accessibility_status?.value===''||!form.elements.accessibility_status?null:Number(form.elements.accessibility_status.value),
    accessibility_details:optionalText(form,'accessibility_details')
  });
  const catOptions=(selected='')=>categories.map(item=>`<option value="${esc(item.id)}" ${String(item.id)===String(selected)?'selected':''}>${esc(item.name)}</option>`).join('');
  const buildingOptions=(selected='')=>locations.filter(item=>item.kind==='building').map(item=>`<option value="${esc(item.id)}" ${String(item.id)===String(selected)?'selected':''}>${esc(item.name)}</option>`).join('');

  const ensureEditor=()=>{
    if(document.getElementById('catalog-editor'))return;
    const dialog=document.createElement('dialog');dialog.id='catalog-editor';dialog.className='admin-edit-dialog';
    dialog.innerHTML='<form id="catalog-editor-form" method="dialog" novalidate><div class="admin-edit-dialog-heading"><div><h2 id="catalog-editor-title">Edit campus record</h2><p>Update the fields below, then save your changes.</p></div><button type="button" data-editor-close aria-label="Close editor">×</button></div><div id="catalog-editor-fields" class="admin-edit-fields"></div><p id="catalog-editor-status" class="min-h-5 text-xs" role="status" aria-live="polite"></p><div class="admin-edit-actions"><button type="button" data-editor-close class="admin-button-secondary">Cancel</button><button type="submit" class="admin-button-primary">Save changes</button></div></form>';
    document.body.append(dialog);
    dialog.querySelectorAll('[data-editor-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('click',manageGalleryAction);
    dialog.querySelector('form').addEventListener('submit',saveEditor);
  };
  const field=(label,name,value,type='text',required=false,extra='')=>`<label>${label}${required?' <span class="text-red-600" aria-label="required">*</span>':''}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${extra}></label>`;
  const selectField=(label,name,options,selected,required=true)=>`<label>${label}${required?' <span class="text-red-600" aria-label="required">*</span>':''}<select name="${name}" ${required?'required':''}>${options}</select></label>`;
  const areaField=(label,name,value,max=1000)=>`<label class="admin-edit-wide">${label}<textarea name="${name}" rows="2" maxlength="${max}">${esc(value||'')}</textarea></label>`;
  const accessibilityFeatureOptions=[
    ['wheelchair_entrance','Wheelchair-accessible entrance'],['elevator','Elevator'],['ramp','Ramp'],
    ['accessible_restroom','Accessible restroom'],['accessible_parking','Accessible parking'],['handrails','Handrails'],
    ['tactile_paving','Tactile paving'],['braille_signage','Braille signage'],['hearing_assistance','Hearing assistance']
  ];
  const accessibilityFeatureFields=selected=>`<fieldset class="admin-edit-wide rounded-xl border border-blue-100 bg-blue-50/60 p-4"><legend class="px-1 font-bold">Building accessibility features</legend><p class="mb-3 text-xs text-slate-500">Building-wide features only; do not use this list for an individual room.</p><div class="grid gap-2 sm:grid-cols-2">${accessibilityFeatureOptions.map(([value,label])=>`<label class="flex items-center gap-2 text-xs"><input type="checkbox" name="accessibility_features" value="${value}" ${selected.includes(value)?'checked':''}>${label}</label>`).join('')}</div></fieldset>`;
  const extraLocationFields=item=>field('Department','department_name',item.department_name||'','text',false,'maxlength="160"')+
    field('Contact email','contact_email',item.contact_email||'','email',false,'maxlength="254"')+field('Contact phone','contact_phone',item.contact_phone||'','tel',false,'maxlength="40"')+
    field('Website','website_url',item.website_url||'','url',false,'maxlength="500"')+field('Service hours','service_hours',item.service_hours||'','text',false,'maxlength="500"')+
    field('Access hours','access_hours',item.access_hours||'','text',false,'maxlength="500"')+field('Days open','days_open',item.days_open||'','text',false,'maxlength="160"')+
    field('Lunch break','lunch_break',item.lunch_break||'','text',false,'maxlength="160"')+areaField('Services','services',item.services,4000)+
    field('Nearby landmarks','nearby_landmarks',item.nearby_landmarks||'','text',false,'maxlength="1000"')+
    selectField('Accessibility information','accessibility_status','<option value="">Not recorded</option><option value="1">Accessible</option><option value="0">Not accessible</option>',item.accessibility_status===null||item.accessibility_status===undefined?'':String(item.accessibility_status),false)+
    areaField('Accessibility details','accessibility_details',item.accessibility_details,1000);
  const extraRoomFields=item=>field('Department','department_name',item.department_name||'','text',false,'maxlength="160"')+
    field('Contact email','contact_email',item.contact_email||'','email',false,'maxlength="254"')+field('Contact phone','contact_phone',item.contact_phone||'','tel',false,'maxlength="40"')+
    field('Website','website_url',item.website_url||'','url',false,'maxlength="500"')+field('Service hours','service_hours',item.service_hours||'','text',false,'maxlength="500"')+
    field('Days open','days_open',item.days_open||'','text',false,'maxlength="160"')+field('Lunch break','lunch_break',item.lunch_break||'','text',false,'maxlength="160"')+
    areaField('Services','services',item.services,4000)+field('Nearby landmarks','nearby_landmarks',item.nearby_landmarks||'','text',false,'maxlength="1000"')+
    selectField('Accessibility information','accessibility_status','<option value="">Not recorded</option><option value="1">Accessible</option><option value="0">Not accessible</option>',item.accessibility_status===null||item.accessibility_status===undefined?'':String(item.accessibility_status),false)+
    areaField('Accessibility details','accessibility_details',item.accessibility_details,1000);
  function galleryMarkup(type,item){
    const ownerType=type==='location'?'location':'room';
    const photos=item.photos||[];
    return `<section class="admin-edit-wide" data-gallery-owner="${ownerType}" data-gallery-id="${esc(item.id)}"><h3 class="font-bold">Photo gallery</h3><p class="text-xs text-slate-500">Upload photos one at a time and provide accurate alternative text for each image.</p><div class="mt-3 grid gap-2">${photos.map(photo=>`<div class="rounded-lg border p-3" data-photo-id="${esc(photo.id)}"><img src="${esc(CampusApi.assetUrl(photo.image))}" alt="${esc(photo.altText)}" class="mb-2 h-24 w-full rounded object-cover"><label>Alternative text<input data-photo-alt maxlength="255" required value="${esc(photo.altText)}"></label><label class="mt-2 block">Caption<input data-photo-caption maxlength="255" value="${esc(photo.caption||'')}"></label><label class="mt-2 flex items-center gap-2"><input type="checkbox" data-photo-cover ${Number(photo.isCover)?'checked':''}> Use as cover photo</label><div class="mt-2 flex gap-2"><button type="button" data-photo-save class="admin-button-secondary">Save photo details</button><button type="button" data-photo-delete class="admin-button-secondary">Remove photo</button></div></div>`).join('')||'<p class="text-xs text-slate-500">No gallery photos have been added.</p>'}</div><div class="mt-3 grid gap-2"><label>New photo<input type="file" data-gallery-file accept="image/png,image/jpeg,image/webp"></label><label>Alternative text<input data-gallery-alt maxlength="255" required placeholder="Describe what this image shows"></label><label>Caption<input data-gallery-caption maxlength="255"></label><button type="button" data-photo-add class="admin-button-primary">Upload photo</button></div></section>`;
  }
  function openEditor(type,item){
    ensureEditor();pendingEdit={type,item};
    const dialog=document.getElementById('catalog-editor'),fields=document.getElementById('catalog-editor-fields');
    const categoryList='<option value="">Select a category</option>'+catOptions(item.category_id||categories.find(category=>category.name===item.category)?.id);
    if(type==='location'){
      document.getElementById('catalog-editor-title').textContent=item.kind==='building'?'Edit building':'Edit facility';
      fields.innerHTML=field('Name','name',item.name,'text',true,'maxlength="150"')+
        selectField('Category','category_id',categoryList,item.category_id||categories.find(category=>category.name===item.category)?.id)+
        (item.kind==='building'?field('Building number','building_number',item.building_number||'','text',false,'maxlength="40"')+field('Number of floors','floor_count',item.floor_count||1,'number',true,'min="1" max="100"'):selectField('Associated building','parent_building_id','<option value="">No building selected</option>'+buildingOptions(item.parent_building_id),item.parent_building_id,false)+field('Floor','floor_label',item.floor_label||'','text',false,'maxlength="80"'))+
        field('Capacity','capacity',item.capacity??'','number',false,'min="0"')+
        '<label class="admin-edit-wide">Description<textarea name="description" rows="4" maxlength="4000">'+esc(item.description||'')+'</textarea></label>'+
        (item.kind==='building'?accessibilityFeatureFields(item.accessibility_features||[]):'')+extraLocationFields(item)+galleryMarkup(type,item);
    }else if(type==='room'){
      document.getElementById('catalog-editor-title').textContent='Edit room or classroom';
      fields.innerHTML=field('Room name','name',item.name,'text',true,'maxlength="150"')+
        field('Room number','room_number',item.room_number,'text',true,'maxlength="50"')+
        selectField('Building','building_id','<option value="">Select a building</option>'+buildingOptions(item.building_id),item.building_id)+
        selectField('Category','category_id',categoryList,item.category_id)+
        field('Floor name','floor_label',item.floor_label||'','text',false,'maxlength="80"')+
        field('Maximum capacity','capacity',item.capacity??'','number',false,'min="0"')+
        '<label class="admin-edit-wide">Description<textarea name="description" rows="3" maxlength="4000">'+esc(item.description||'')+'</textarea></label>'+ 
        '<label class="admin-edit-wide">Room function<textarea name="function_description" rows="2" maxlength="1000">'+esc(item.function_description||'')+'</textarea></label>'+ 
        field('Department head','department_head',item.department_head||'','text',false,'maxlength="120"')+
        field('Contact information','contact_info',item.contact_info||'','text',false,'maxlength="180"')+extraRoomFields(item)+galleryMarkup(type,item);
    }
    async function manageGalleryAction(event){
      const button=event.target.closest('[data-photo-add],[data-photo-save],[data-photo-delete]');if(!button)return;
      const section=button.closest('[data-gallery-owner]'),card=button.closest('[data-photo-id]'),status=document.getElementById('catalog-editor-status');
      if(!section)return;
      button.disabled=true;
      try{
        if(button.hasAttribute('data-photo-add')){
          const fileInput=section.querySelector('[data-gallery-file]'),altInput=section.querySelector('[data-gallery-alt]'),captionInput=section.querySelector('[data-gallery-caption]');
          if(!fileInput.files?.length||!altInput.value.trim()){status.textContent='Choose a photo and enter descriptive alternative text.';return;}
          const image_path=await upload(fileInput);
          await CampusApi.request('facility-photos',{method:'POST',body:{owner_type:section.dataset.galleryOwner,owner_id:Number(section.dataset.galleryId),image_path,alt_text:altInput.value.trim(),caption:captionInput.value.trim()||null}});
          status.textContent='Photo added to the gallery.';
        }else if(button.hasAttribute('data-photo-save')){
          const altText=card.querySelector('[data-photo-alt]').value.trim();if(!altText){status.textContent='Alternative text is required.';return;}
          await CampusApi.request('facility-photos',{method:'PUT',body:{id:Number(card.dataset.photoId),alt_text:altText,caption:card.querySelector('[data-photo-caption]').value.trim()||null,is_cover:card.querySelector('[data-photo-cover]').checked,sort_order:0}});
          status.textContent='Photo details saved.';
        }else{
          if(!confirm('Remove this photo from the gallery?'))return;
          await CampusApi.remove('facility-photos',Number(card.dataset.photoId));status.textContent='Photo removed from the gallery.';
        }
        await refresh();const item=section.dataset.galleryOwner==='location'?locations.find(row=>String(row.id)===section.dataset.galleryId):rooms.find(row=>String(row.id)===section.dataset.galleryId);
        if(item)section.outerHTML=galleryMarkup(section.dataset.galleryOwner==='location'?'location':'room',item);
      }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    }
    document.getElementById('catalog-editor-status').textContent='';
    dialog.showModal();dialog.querySelector('input,select,textarea')?.focus();
  }
  async function saveEditor(event){
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),message=document.getElementById('catalog-editor-status');
    if(!form.reportValidity())return;button.disabled=true;message.textContent='Saving changes…';
    const data=new FormData(form),value=name=>String(data.get(name)||'').trim(),item=pendingEdit.item;
    try{
      if(pendingEdit.type==='location'){
        const isBuilding=item.kind==='building';
        const accessibilityFeatures=isBuilding?[...form.querySelectorAll('[name="accessibility_features"]:checked')].map(control=>control.value):[];
        await CampusApi.save('locations',{name:value('name'),kind:item.kind,category_id:Number(value('category_id')),description:value('description')||null,building_number:isBuilding?(value('building_number')||null):(item.building_number||null),floor_label:isBuilding?null:(value('floor_label')||null),floor_count:isBuilding?Number(value('floor_count')||item.floor_count||1):1,parent_building_id:isBuilding?null:(value('parent_building_id')||null),capacity:value('capacity')===''?null:Number(value('capacity')),image_path:item.image_path||null,department_name:value('department_name')||null,contact_email:value('contact_email')||null,contact_phone:value('contact_phone')||null,website_url:value('website_url')||null,service_hours:value('service_hours')||null,access_hours:value('access_hours')||null,days_open:value('days_open')||null,lunch_break:value('lunch_break')||null,services:value('services')||null,nearby_landmarks:value('nearby_landmarks')||null,accessibility_status:value('accessibility_status')===''?null:Number(value('accessibility_status')),accessibility_details:value('accessibility_details')||null,accessibility_features:accessibilityFeatures},item.id);
      }else{
        const floorLabel=value('floor_label');
        await CampusApi.save('rooms',{name:value('name'),room_number:value('room_number'),building_id:Number(value('building_id')),category_id:Number(value('category_id')),floor_label:floorLabel||null,floor_number:Number((floorLabel.match(/\d+/)||[])[0]||item.floor_number||0),capacity:value('capacity')===''?null:Number(value('capacity')),description:value('description')||null,function_description:value('function_description')||null,department_head:value('department_head')||null,contact_info:value('contact_info')||null,image_path:item.image_path||null,department_name:value('department_name')||null,contact_email:value('contact_email')||null,contact_phone:value('contact_phone')||null,website_url:value('website_url')||null,service_hours:value('service_hours')||null,days_open:value('days_open')||null,lunch_break:value('lunch_break')||null,services:value('services')||null,nearby_landmarks:value('nearby_landmarks')||null,accessibility_status:value('accessibility_status')===''?null:Number(value('accessibility_status')),accessibility_details:value('accessibility_details')||null},item.id);
      }
      message.textContent='Changes saved.';await refresh();renderAll();status('Changes saved to the campus database.');document.getElementById('catalog-editor').close();
    }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
  }
  const listToolbar=(kind,label,query)=>`<div class="admin-list-toolbar"><div><h2>${label}</h2><p>${query.length} record${query.length===1?'':'s'}</p></div><label class="admin-search"><span class="material-symbols-rounded" aria-hidden="true">search</span><span class="sr-only">Search ${label.toLowerCase()}</span><input type="search" data-list-search="${kind}" value="${esc(searchTerms[kind])}" placeholder="Search ${label.toLowerCase()}" autocomplete="off"></label></div>`;
  const emptyState=(label,filtered)=>`<div class="catalog-directory-empty"><span class="material-symbols-rounded" aria-hidden="true">${filtered?'search_off':'location_city'}</span><h3>${filtered?'No matching records':`No ${label.toLowerCase()} yet`}</h3><p>${filtered?`Try another search to find ${label.toLowerCase()}.`:`Add a ${label.replace(/s$/,'').toLowerCase()} above to see it in this directory.`}</p></div>`;
  const catalogCards=(rows,kind)=>`<div class="catalog-list-cards ${kind==='building'||kind==='room'?'catalog-list-rows':''}">${rows.map(item=>{
    const room=kind==='room',building=kind==='building';
    const parent=room?item.building_name:building?`${item.floor_count||1} floor${Number(item.floor_count)===1?'':'s'}`:locations.find(location=>String(location.id)===String(item.parent_building_id))?.name||'Building not assigned';
    const photo=item.photos?.find(entry=>Number(entry.isCover))||item.photos?.[0];
    const image=item.image_path||item.image||photo?.image;
    const kindLabel=room?'Room':building?'Building':'Facility';
    const detailHref=room?`../office.html?id=${encodeURIComponent(item.id)}`:`../building.html?id=${encodeURIComponent(item.id)}`;
    const mapHref=`../map.html?search=${encodeURIComponent(item.name)}`;
    const subtitle=room?`${parent||'Building unavailable'} · ${item.floor_label||'Floor unavailable'} · Room ${item.room_number||'—'}`:building?parent:`Located in ${parent}`;
    return `<article class="catalog-directory-card" data-id="${esc(item.id)}">
      <div class="catalog-directory-photo">${image?`<img src="${esc(CampusApi.assetUrl(image))}" alt="" loading="lazy">`:`<span class="material-symbols-rounded" aria-hidden="true">${room?'meeting_room':building?'location_city':'storefront'}</span>`}</div>
      <div class="catalog-directory-info"><div class="catalog-directory-meta"><span>${kindLabel}</span><span>${esc(item.category||'Campus')}</span></div><h3>${esc(item.name)}</h3><p class="catalog-directory-description">${esc(item.description||'More information is available in this directory profile.')}</p><p class="catalog-directory-location">${esc(subtitle)}</p></div>
      <div class="catalog-directory-actions"><a href="${mapHref}"><span class="material-symbols-rounded" aria-hidden="true">map</span><span>Show on map</span></a><a href="${detailHref}"><span>Details</span><span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></a><span class="catalog-row-action-group"><button data-action="edit" class="admin-row-action">Edit</button><button data-action="archive" class="admin-row-action is-danger">Archive</button></span></div>
    </article>`;
  }).join('')}</div>`;
  function renderLocations(kind){
    const target=document.getElementById(kind==='building'?'buildings-list':'facilities-list');if(!target)return;
    const term=searchTerms[kind].toLocaleLowerCase();const all=locations.filter(item=>item.kind===kind);const rows=all.filter(item=>`${item.name} ${item.category||''} ${item.building_number||''}`.toLocaleLowerCase().includes(term));
    target.innerHTML=listToolbar(kind,kind==='building'?'Buildings':'Facilities',rows)+(rows.length?catalogCards(rows,kind):emptyState(kind==='building'?'buildings':'facilities',!!term));
    target.querySelector('[data-list-search]')?.addEventListener('input',event=>{const cursor=event.target.selectionStart;searchTerms[kind]=event.target.value;renderLocations(kind);const input=target.querySelector('[data-list-search]');input.focus();input.setSelectionRange(cursor,cursor);});
    target.querySelector('.catalog-list-cards')?.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;const item=all.find(record=>String(record.id)===button.closest('[data-id]').dataset.id);if(!item)return;if(button.dataset.action==='edit'){openEditor('location',item);return;}if(button.dataset.action==='archive'&&!confirm(`Archive ${item.name}?`))return;button.disabled=true;
      try{await CampusApi.remove('locations',item.id);status('Campus record archived.');await refresh();renderAll();
      }catch(error){status(error.message);}finally{button.disabled=false;}
    });
  }
  function renderRooms(){
    const target=document.getElementById('classrooms-list');if(!target)return;const term=searchTerms.room.toLocaleLowerCase();
    const rows=rooms.filter(room=>`${room.name} ${room.room_number} ${room.building_name} ${room.floor_label||''}`.toLocaleLowerCase().includes(term));
    target.innerHTML=listToolbar('room','Rooms and classrooms',rows)+(rows.length?catalogCards(rows,'room'):emptyState('rooms',!!term));
    target.querySelector('[data-list-search]')?.addEventListener('input',event=>{const cursor=event.target.selectionStart;searchTerms.room=event.target.value;renderRooms();const input=target.querySelector('[data-list-search]');input.focus();input.setSelectionRange(cursor,cursor);});
    target.querySelector('.catalog-list-cards')?.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;const item=rooms.find(room=>String(room.id)===button.closest('[data-id]').dataset.id);if(!item)return;if(button.dataset.action==='edit'){openEditor('room',item);return;}if(button.dataset.action==='archive'&&!confirm(`Archive room ${item.room_number} — ${item.name}?`))return;button.disabled=true;
      try{if(button.dataset.action==='archive'){await CampusApi.remove('rooms',item.id);status('Room archived.');}await refresh();renderAll();
      }catch(error){status(error.message);}finally{button.disabled=false;}
    });
  }
  function renderCategories(){
    const target=document.getElementById('categories-list');if(!target)return;target.innerHTML=categories.length?categories.map(item=>`<div class="admin-category-row" data-id="${esc(item.id)}"><span>${esc(item.name)}</span><button data-action="edit" class="admin-row-action">Rename</button><button data-action="delete" class="admin-row-action is-danger">Remove</button></div>`).join(''):'<p class="p-5 text-xs text-slate-500">No categories available.</p>';
    target.onclick=async event=>{const button=event.target.closest('[data-action]');if(!button)return;const item=categories.find(record=>String(record.id)===button.parentElement.dataset.id);if(!item)return;
      if(button.dataset.action==='edit'){const row=button.parentElement;row.innerHTML=`<label class="sr-only" for="category-edit-${esc(item.id)}">Category name</label><input id="category-edit-${esc(item.id)}" maxlength="80" value="${esc(item.name)}"><button data-action="save" class="admin-row-action">Save</button><button data-action="cancel" class="admin-row-action">Cancel</button>`;row.querySelector('input').focus();return;}
      if(button.dataset.action==='cancel'){renderCategories();return;}
      try{if(button.dataset.action==='delete'){if(!confirm(`Remove category ${item.name}?`))return;await CampusApi.remove('categories',item.id);}else if(button.dataset.action==='save'){const name=button.parentElement.querySelector('input').value.trim();if(!name){status('Enter a category name.');return;}await CampusApi.save('categories',{name},item.id);}await refresh();renderCategories();status('Category changes saved.');}catch(error){status(error.message);}
    };
  }
  function renderAll(){renderLocations('building');renderLocations('facility');renderRooms();renderCategories();}
  try{
    await refresh();
    if(categoryPage){renderCategories();document.querySelectorAll('[data-category-form]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;try{await CampusApi.save('categories',{name:form.elements.category.value.trim()});await refresh();renderCategories();form.reset();status('Category saved.');}catch(error){status(error.message);}finally{button.disabled=false;}}));return;}
    for(const form of [buildingForm,facilityForm,roomForm].filter(Boolean)){
      if(form.elements.category)form.elements.category.innerHTML=categories.map(category=>`<option value="${esc(category.name)}">${esc(category.name)}</option>`).join('');
      if(form.elements.buildingId)form.elements.buildingId.innerHTML=buildingOptions();
      const preview=form.querySelector('[data-photo-preview]');if(form.elements.photo&&preview)window.CampusPhotoTools?.bindPreview(form.elements.photo,preview);
      form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;status('Saving to the campus database…');
        try{const image_path=await upload(form.elements.photo);let payload,resource;
          if(form===buildingForm){resource='locations';payload={name:form.elements.name.value.trim(),kind:'building',category:form.elements.category.value,description:optionalText(form,'description'),building_number:optionalText(form,'building_number'),floor_count:Number(form.elements.floors.value),capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),access_hours:optionalText(form,'access_hours'),image_path,...detailPayload(form),accessibility_features:[...form.querySelectorAll('[name="accessibility_features"]:checked')].map(control=>control.value)};}
          else if(form===facilityForm){resource='locations';payload={name:form.elements.name.value.trim(),kind:'facility',category:form.elements.category.value,parent_building_id:form.elements.buildingId.value||null,floor_label:optionalText(form,'floor'),description:optionalText(form,'description'),floor_count:1,capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),access_hours:optionalText(form,'access_hours'),image_path,...detailPayload(form)};}
          else{resource='rooms';payload={name:form.elements.name.value.trim(),building_id:Number(form.elements.buildingId.value),category:form.elements.category.value,room_number:form.elements.room.value.trim(),floor_label:form.elements.floor.value.trim(),floor_number:Number((form.elements.floor.value.match(/\d+/)||[])[0]||0),capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),department_head:optionalText(form,'head'),contact_info:optionalText(form,'contact'),description:optionalText(form,'description'),function_description:optionalText(form,'function_description'),image_path,...detailPayload(form)};}
          await CampusApi.save(resource,payload);await refresh();renderAll();form.reset();if(form.elements.floors)form.elements.floors.value='1';if(form.elements.floor)form.elements.floor.value='Ground Level';if(form.elements.capacity)form.elements.capacity.value='0';status('Saved to the campus database.');
        }catch(error){status(error.message);}finally{button.disabled=false;}
      });
    }
    renderAll();
  }catch(error){status(error.message);const target=document.getElementById('buildings-list')||document.getElementById('facilities-list')||document.getElementById('classrooms-list');if(target)target.innerHTML=`<p class="p-5 text-center text-sm text-red-600">${esc(error.message)} <button onclick="location.reload()" class="underline">Retry</button></p>`;}
});
