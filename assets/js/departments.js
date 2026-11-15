(() => {
 const $=s=>document.querySelector(s), list=$('#list'), search=$('#search'), filter=$('#building'), count=$('#count');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let rows=[];
 function render(){
  const q=search.value.trim().toLowerCase(), building=filter.value;
  const visible=rows.filter(d=>{
   const text=[d.name,d.description,...(d.locations||[]).flatMap(x=>[x.building?.name,x.room?.name,x.room?.room_number])].join(' ').toLowerCase();
   return (!q||text.includes(q))&&(!building||(d.locations||[]).some(x=>String(x.building?.id)===building));
  });
  count.textContent=visible.length+' department'+(visible.length===1?'':'s');
  list.innerHTML=visible.length?visible.map(d=>{
   const loc=(d.locations||[]).map(x=>`<div class="border-t border-slate-100 pt-3 mt-3"><div class="font-bold">${esc(x.building.name)}</div><p class="text-sm text-slate-600">${[x.floor_number!=null?'Floor '+x.floor_number:'',x.room_number?'Room '+x.room_number:'',x.room?.name].filter(Boolean).map(esc).join(' · ')||'Building assignment'}</p><a class="text-sm text-blue-800 font-bold" href="../pages/map.html?search=${encodeURIComponent(x.building.name)}">Show on Map →</a></div>`).join('');
   return `<article class="bg-white border border-slate-200 rounded-2xl p-5"><h2 class="text-xl font-extrabold">${esc(d.name)}</h2>${d.description?`<p class="text-sm text-slate-600 mt-2">${esc(d.description)}</p>`:''}${d.office_hours?`<p class="text-sm mt-2"><b>Office hours:</b> ${esc(d.office_hours)}</p>`:''}${d.contact_email?`<p class="text-sm mt-1"><b>Email:</b> <a class="text-blue-800" href="mailto:${esc(d.contact_email)}">${esc(d.contact_email)}</a></p>`:''}${loc||'<p class="text-sm text-slate-500 mt-3">No building assignment has been recorded yet.</p>'}</article>`;
  }).join(''):'<div class="bg-white rounded-xl p-6 text-slate-500">No departments match your search. Try another term or clear the building filter.</div>';
 }
 fetch('/.netlify/functions/departments').then(async r=>{const p=await r.json();if(!r.ok||!p.ok)throw Error(p.error?.message||'Could not load department directory.');rows=p.data||[];const buildings=new Map();rows.forEach(d=>(d.locations||[]).forEach(x=>{if(x.building)buildings.set(String(x.building.id),x.building.name)}));[...buildings].sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name])=>filter.add(new Option(name,id)));render();}).catch(e=>{count.textContent='Directory unavailable';list.innerHTML='<div class="bg-white rounded-xl p-6 text-red-700">'+esc(e.message)+'</div>';});
 search.addEventListener('input',render);filter.addEventListener('change',render);
})();