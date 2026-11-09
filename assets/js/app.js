(() => {
  const key=document.body.classList.contains('admin-page')?'navigatorate.admin.preferences':'navigatorate.visitor.preferences';
  try{
    const prefs=JSON.parse(localStorage.getItem(key)||'{}')||{},root=document.documentElement;
    root.dataset.theme=prefs.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):(prefs.theme||'light');
    root.dataset.textSize=prefs.textSize||'normal';
    root.toggleAttribute('data-high-contrast',!!prefs.highContrast);
    root.toggleAttribute('data-reduce-motion',!!prefs.reduceMotion);
  }catch(error){console.warn('Saved accessibility preferences could not be applied.',error);}
})();

function renderSharedUI() {
  const header = document.querySelector("[data-component='header']");
  const bottomNav = document.querySelector("[data-component='bottom-nav']");

  const isInsidePagesFolder = window.location.pathname.includes('/pages/');
  const isAdminPage = window.location.pathname.includes('/pages/admin/') && !window.location.pathname.endsWith('/login.html');
  const pathPrefix = isAdminPage ? '../../' : isInsidePagesFolder ? '../' : '';

  if (header) {
    header.innerHTML = `
      <header class="app-header w-full bg-[#0b1329] border-b border-slate-800 sticky top-0 z-[70]">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 h-[64px] flex items-center justify-between">
          <a href="${pathPrefix}index.html" class="flex items-center gap-3">
            <span aria-hidden="true" class="grid h-9 w-9 place-items-center rounded-full bg-white text-[11px] font-black text-[#0b1329] shadow-sm">LC</span>
            <div class="flex flex-col">
              <span class="font-black text-lg text-white leading-none">
                Navi<span class="text-[#3b82f6]">GATE</span>
              </span>
              <span class="text-[10px] text-slate-400 font-medium mt-0.5">
                La Consolacion University Philippines
              </span>
            </div>
          </a>

          <a href="${pathPrefix}pages/map.html" class="${isAdminPage ? 'admin-map-shortcut ' : ''}flex items-center gap-2 bg-[#172746] hover:bg-[#1e345e] px-3.5 py-1.5 rounded-full border border-slate-700/80 transition-colors">
            <span class="material-symbols-rounded text-blue-400 text-sm">location_on</span>
            <span class="text-xs text-white font-semibold">Main Campus Map</span>
          </a>
          ${isAdminPage ? '<button type="button" data-admin-menu-toggle aria-label="Open admin navigation" aria-expanded="false" class="mr-auto ml-3 grid h-10 w-10 place-items-center rounded-lg border border-slate-700 text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><span class="material-symbols-rounded">menu</span></button><a href="#" data-admin-logout class="ml-2 text-xs font-bold text-slate-300 hover:text-white">Sign out</a>' : ''}
        </div>
      </header>
    `;
  }

  if (isAdminPage && header && !document.querySelector('[data-admin-sidebar]')) {
    const items = [
      { group: 'Overview', links: [['dashboard.html','Dashboard','space_dashboard']] },
      { group: 'Campus information', links: [['manage-buildings.html','Buildings','domain'],['manage-facilities.html','Facilities','storefront'],['manage-rooms.html','Rooms and Classrooms','meeting_room'],['manage-categories.html','Categories','category'],['manage-map.html','Campus Map','map'],['manage-map.html#route-builder','Walking Routes','alt_route'],['manage-map.html#floorplan-title','Floor Plans','floor'] ] },
      { group: 'Communication', links: [['manage-announcements.html','Announcements','campaign'],['manage-announcements.html#event-fields','Events and Schedules','event']] },
      { group: 'Account management', links: [['admin-accounts.html','Admin Accounts','manage_accounts']] },
      { group: 'Settings', links: [['admin-settings.html','Settings','settings']] },
      { group: 'System', links: [['dashboard.html#recent-activity','Activity Log','history'],['#','Sign out','logout']] },
    ];
    const current = window.location.pathname.split('/').pop().toLowerCase();
    const aside = document.createElement('aside');
    aside.id = 'admin-sidebar'; aside.className = 'admin-sidebar'; aside.setAttribute('data-admin-sidebar','');
    aside.setAttribute('aria-label','Administrator navigation');
    aside.innerHTML = `<div class="admin-sidebar-heading"><span>Manage App</span><button type="button" data-admin-collapse aria-label="Collapse navigation" title="Collapse navigation">‹</button></div>${items.map(section => `<section class="admin-sidebar-section"><h2>${section.group}</h2><nav>${section.links.map(([href,label,icon]) => { const target=href.split('#')[0], hash=href.includes('#')?href.slice(href.indexOf('#')):''; const specialHash=['#route-builder','#floorplan-title','#event-fields'].includes(location.hash); const active=target && current===target && (hash ? location.hash===hash : !((current==='manage-map.html'||current==='manage-announcements.html')&&specialHash)); return `<a href="${href}" ${label==='Sign out'?'data-admin-logout':''} aria-label="${label}" title="${label}" ${active?'aria-current="page"':''}><span class="material-symbols-rounded" aria-hidden="true">${icon}</span><span>${label}</span></a>`; }).join('')}</nav></section>`).join('')}`;
    const main = document.querySelector('main.admin-main');
    if (main) { document.body.insertBefore(aside, main); main.classList.add('has-admin-sidebar'); }
    const backdrop = document.createElement('button'); backdrop.type='button'; backdrop.className='admin-sidebar-backdrop'; backdrop.setAttribute('aria-label','Close administrator navigation'); document.body.append(backdrop);
    const toggle = document.querySelector('[data-admin-menu-toggle]');
    const closeMenu = () => { document.body.classList.remove('admin-menu-open'); toggle?.setAttribute('aria-expanded','false'); };
    toggle?.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 900px)').matches) { const open=document.body.classList.toggle('admin-menu-open'); toggle.setAttribute('aria-expanded',String(open)); }
      else document.body.classList.toggle('admin-sidebar-collapsed');
    });
    backdrop.addEventListener('click',closeMenu);
    aside.querySelector('[data-admin-collapse]')?.addEventListener('click',event=>{const compact=document.body.classList.toggle('admin-sidebar-collapsed');event.currentTarget.setAttribute('aria-label',compact?'Expand navigation':'Collapse navigation');event.currentTarget.title=compact?'Expand navigation':'Collapse navigation';});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
  }

  if (bottomNav) {
    bottomNav.innerHTML = `
      <nav aria-label="Main navigation" class="floating-nav fixed bottom-3 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between px-4 sm:px-6 py-2 rounded-2xl w-[min(92%,24rem)] bg-[#111c35] border border-slate-700/80 shadow-2xl" style="padding-bottom: max(.5rem, env(safe-area-inset-bottom))">
        <a data-nav="home" href="${pathPrefix}index.html" class="flex flex-col items-center gap-1 text-slate-400 transition-colors px-3 py-1 rounded-xl">
          <span class="material-symbols-rounded text-xl">home</span>
          <span class="text-[11px] font-bold">Home</span>
        </a>
        <a data-nav="directory" href="${pathPrefix}pages/directory.html" class="flex flex-col items-center gap-1 text-slate-400 transition-colors px-3 py-1 rounded-xl">
          <span class="material-symbols-rounded text-xl">apartment</span>
          <span class="text-[11px] font-bold">Directory</span>
        </a>
        <a data-nav="map" href="${pathPrefix}pages/map.html" class="flex flex-col items-center gap-1 text-slate-400 transition-colors px-3 py-1 rounded-xl">
          <span class="material-symbols-rounded text-xl">map</span>
          <span class="text-[11px] font-bold">Map</span>
        </a>
        <a data-nav="settings" href="${pathPrefix}pages/settings.html" class="flex flex-col items-center gap-1 text-slate-400 transition-colors px-3 py-1 rounded-xl">
          <span class="material-symbols-rounded text-xl">settings</span>
          <span class="text-[11px] font-bold">Settings</span>
        </a>
      </nav>
    `;
    const path = window.location.pathname.toLowerCase();
    const active = path.endsWith('/map.html') || path.endsWith('/map-directory.html')
      ? 'map'
      : path.endsWith('/directory.html') || path.endsWith('/building.html') || path.endsWith('/office.html')
        ? 'directory'
          : path.endsWith('/settings.html')
            ? 'settings'
            : path.endsWith('/index.html') || path === '/' || path.endsWith('/announcements.html')
          ? 'home'
          : '';
    if (active) setActiveNav(active);
  }

  const guestChoice = document.querySelector('[data-role-choice="student-guest"]');
  const roleSplash = document.getElementById('role-splash');
  if (guestChoice && roleSplash) {
    const adminChoice = document.querySelector('[data-role-choice="admin"]');
    const navigationEntry = performance.getEntriesByType?.('navigation')?.[0];
    const isReload = navigationEntry?.type === 'reload';
    let sameOriginReferrer = false;
    try { sameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch {}
    const isFreshLaunch = !isReload && !sameOriginReferrer;
    const forceRoleSelection = new URLSearchParams(location.search).get('choose-role') === '1';
    const status = document.getElementById('role-splash-status');
    const dismissRoleSplash = () => {
      roleSplash.classList.add('role-splash-dismissed');
      roleSplash.setAttribute('aria-hidden', 'true');
      roleSplash.setAttribute('inert', '');
      document.getElementById('welcome-title')?.focus({ preventScroll: true });
    };
    const revealRoleSplash = () => {
      roleSplash.classList.remove('role-splash-checking');
      roleSplash.removeAttribute('aria-hidden');
      roleSplash.removeAttribute('inert');
    };
    roleSplash.setAttribute('aria-hidden', 'true');
    roleSplash.setAttribute('inert', '');
    window.CampusApi.get('auth/entry').then(state => {
      if (state.role === 'admin' && adminChoice) adminChoice.href = 'pages/admin/dashboard.html';
      if (forceRoleSelection || isFreshLaunch) revealRoleSplash();
      else dismissRoleSplash();
    }).catch(() => {
      if (forceRoleSelection || isFreshLaunch) revealRoleSplash();
      else dismissRoleSplash();
    });
    guestChoice.addEventListener('click', async () => {
      guestChoice.disabled = true;
      if (status) status.textContent = 'Starting visitor session…';
      try {
        await window.CampusApi.request('auth/entry', { method: 'POST', body: { role: 'visitor' } });
        try { localStorage.setItem('navigatorate.entry.choice', 'visitor'); } catch {}
        if (forceRoleSelection) history.replaceState({}, '', location.pathname);
        dismissRoleSplash();
      } catch (error) {
        if (status) status.textContent = error.message;
        guestChoice.disabled = false;
      }
    });
  }
}

if (document.body.classList.contains('admin-page')) {
  window.AdminUI = {
    toast(message, tone = 'success') {
      let host = document.querySelector('[data-admin-toasts]');
      if (!host) {
        host = document.createElement('div');
        host.className = 'admin-toast-host';
        host.dataset.adminToasts = '';
        host.setAttribute('aria-live', 'polite');
        host.setAttribute('aria-relevant', 'additions');
        document.body.append(host);
      }
      const toast = document.createElement('p');
      toast.className = `admin-toast is-${['success', 'error', 'warning', 'info'].includes(tone) ? tone : 'info'}`;
      toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      toast.textContent = message;
      host.append(toast);
      window.setTimeout(() => {
        toast.classList.add('is-leaving');
        toast.addEventListener('transitionend', () => toast.remove(), {once: true});
        window.setTimeout(() => toast.remove(), 300);
      }, 4200);
    },
    confirm({title = 'Please confirm', message = '', confirmLabel = 'Confirm', danger = false} = {}) {
      return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'admin-confirm-dialog';
        const heading = document.createElement('h2');
        heading.textContent = title;
        const description = document.createElement('p');
        description.textContent = message;
        const actions = document.createElement('div');
        actions.className = 'admin-dialog-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'admin-button-secondary';
        cancel.textContent = 'Cancel';
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = danger ? 'admin-button-danger' : 'admin-button-primary';
        confirm.textContent = confirmLabel;
        actions.append(cancel, confirm);
        dialog.append(heading, description, actions);
        document.body.append(dialog);
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          resolve(value);
          dialog.close();
          dialog.remove();
        };
        cancel.addEventListener('click', () => finish(false));
        confirm.addEventListener('click', () => finish(true));
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        dialog.addEventListener('click', event => { if (event.target === dialog) finish(false); });
        dialog.showModal();
        cancel.focus();
      });
    },
    mountFormDialog(form, {title, description = '', triggerLabel, submitLabel} = {}) {
      const panel = form?.closest('.admin-form-panel');
      const originalHeading = panel?.querySelector('h2');
      const pageHeading = document.querySelector('.admin-page-heading');
      if (!form || !panel || !originalHeading || !pageHeading) return null;

      const dialog = document.createElement('dialog');
      dialog.className = 'admin-create-dialog';
      dialog.setAttribute('aria-labelledby', `admin-dialog-${Math.random().toString(36).slice(2)}`);
      const header = document.createElement('header');
      header.className = 'admin-create-dialog-heading';
      const heading = document.createElement('h2');
      heading.id = dialog.getAttribute('aria-labelledby');
      heading.textContent = title || originalHeading.textContent.trim();
      const supportingText = document.createElement('p');
      supportingText.textContent = description;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'admin-icon-button';
      close.setAttribute('aria-label', 'Close form');
      close.title = 'Close form';
      close.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">close</span>';
      header.append(heading, supportingText, close);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'admin-button-primary admin-create-trigger';
      trigger.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">add</span><span>${String(triggerLabel || title || originalHeading.textContent.trim()).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}</span>`;
      let actionSlot = pageHeading.querySelector('.admin-page-actions');
      if (!actionSlot) {
        actionSlot = document.createElement('div');
        actionSlot.className = 'admin-page-actions';
        pageHeading.append(actionSlot);
      }
      actionSlot.append(trigger);

      originalHeading.remove();
      panel.classList.remove('admin-form-panel', 'rounded-2xl', 'p-5', 'mb-5');
      form.classList.remove('mt-4');
      form.classList.add('admin-create-form');
      const submit = form.querySelector('[type="submit"]');
      if (submit && submitLabel) submit.textContent = submitLabel;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'admin-button-secondary';
      cancel.textContent = 'Cancel';
      submit?.parentElement?.insertBefore(cancel, submit);
      panel.replaceWith(dialog);
      dialog.append(header, panel);
      document.body.append(dialog);

      let dirty = false;
      let onDismiss = () => {};
      form.addEventListener('input', () => { dirty = true; });
      form.addEventListener('change', () => { dirty = true; });
      const requestClose = async () => {
        if (dirty && !await window.AdminUI.confirm({title: 'Discard unsaved changes?', message: 'Your unsaved information will be lost.', confirmLabel: 'Discard changes', danger: true})) return;
        dirty = false;
        dialog.close();
        form.reset();
        onDismiss();
      };
      close.addEventListener('click', requestClose);
      cancel.addEventListener('click', requestClose);
      dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
      dialog.addEventListener('click', event => { if (event.target === dialog) requestClose(); });
      trigger.addEventListener('click', () => {
        dialog.showModal();
        dialog.querySelector('input:not([type="hidden"]),select,textarea')?.focus();
      });
      if (location.hash === `#${form.id}`) dialog.showModal();
      return {
        dialog,
        open() { dialog.showModal(); },
        close() { dirty = false; dialog.close(); },
        setTitle(value, details = description) { heading.textContent = value; supportingText.textContent = details; },
        onDismiss(callback) { onDismiss = callback; },
      };
    },
  };
}

function applyStoredPreferences() {
  const isAdmin = document.body.classList.contains('admin-page');
  const key = isAdmin ? 'navigatorate.admin.preferences' : 'navigatorate.visitor.preferences';
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
  const root = document.documentElement;
  root.dataset.theme = prefs.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (['light','dark'].includes(prefs.theme) ? prefs.theme : 'light');
  root.dataset.textSize = ['small','large'].includes(prefs.textSize) ? prefs.textSize : 'normal';
  root.toggleAttribute('data-high-contrast', !!prefs.highContrast);
  root.toggleAttribute('data-reduce-motion', !!prefs.reduceMotion);
}

applyStoredPreferences();

function setActiveNav(active) {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    const isActive = el.dataset.nav === active;
    if (isActive) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
    if (isActive) {
      el.classList.add("bg-[#3b82f6]", "text-white");
      el.classList.remove("text-slate-400");
    } else {
      el.classList.remove("bg-[#3b82f6]", "text-white");
      el.classList.add("text-slate-400");
    }
  });
}

// Render immediately if DOM is ready, or on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderSharedUI);
} else {
  renderSharedUI();
}
