(() => {
  const $ = selector => document.querySelector(selector);
  const conversation = $('#conversation');
  const form = $('#ask-form');
  const input = $('#question');
  const button = $('#ask-button');
  const status = $('#assistant-status');
  const results = $('#answer-results');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  let latestResults = [];

  function renderSaved() {
    const favorites = read('navigatorate.public.favorites');
    const recents = read('navigatorate.public.recents');
    $('#favorites').innerHTML = favorites.length ? favorites.map(item => `<div class="flex justify-between gap-2 items-center"><a class="text-blue-800 font-semibold" href="${escapeHtml(item.map_url)}">${escapeHtml(item.name)}</a><button data-unfavorite="${escapeHtml(item.name)}" aria-label="Remove favorite" class="text-slate-400">×</button></div>`).join('') : 'Save locations from answers for quick access on this device.';
    $('#recents').innerHTML = recents.length ? recents.map(item => `<button class="block text-left text-blue-800 hover:underline" data-recent="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('') : 'Your recent questions will appear here.';
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) { status.textContent = 'Text-to-speech is not supported by this browser.'; return; }
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function addMessage(text, who) {
    const node = document.createElement('div');
    node.className = `assistant-message ${who === 'user' ? 'assistant-user' : 'assistant-bot'}`;
    node.textContent = text;
    conversation.append(node);
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function renderResults(items) {
    latestResults = items || [];
    results.innerHTML = latestResults.map((item, index) => `<article class="assistant-result">
      <div class="min-w-0"><strong class="block">${escapeHtml(item.name)}</strong><p class="assistant-muted">${escapeHtml([item.building, item.floor != null ? 'Floor '+item.floor : '', item.room ? 'Room '+item.room : ''].filter(Boolean).join(' · ') || item.kind)}</p>${item.description ? `<p class="assistant-muted mt-1">${escapeHtml(item.description)}</p>` : ''}</div>
      <div class="flex flex-col gap-2 text-right"><a class="assistant-action" href="${escapeHtml(item.map_url || '#')}">Show on Map ↗</a><button class="assistant-action" data-favorite="${index}">☆ Save</button></div>
    </article>`).join('');
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    addMessage(question, 'user');
    const recents = [question, ...read('navigatorate.public.recents').filter(item => item !== question)].slice(0, 8);
    write('navigatorate.public.recents', recents);
    renderSaved();
    input.value = '';
    button.disabled = true;
    button.textContent = 'Searching…';
    status.textContent = 'Searching verified campus information…';
    results.innerHTML = '';
    try {
      const response = await fetch('/.netlify/functions/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'The campus assistant is temporarily unavailable.');
      addMessage(payload.data.answer, 'assistant');
      renderResults(payload.data.results);
      status.textContent = '';
      const speech = document.createElement('button');
      speech.type = 'button';
      speech.className = 'assistant-action mt-2';
      speech.textContent = '🔊 Read answer aloud';
      speech.addEventListener('click', () => speak(payload.data.answer));
      conversation.append(speech);
    } catch (error) {
      addMessage(error.message, 'assistant');
      status.textContent = 'Please try again in a moment.';
    } finally {
      button.disabled = false;
      button.textContent = 'Ask';
    }
  });

  $('#suggestions').addEventListener('click', event => {
    const chip = event.target.closest('[data-question]');
    if (!chip) return;
    input.value = chip.dataset.question;
    form.requestSubmit();
  });

  $('#answer-results').addEventListener('click', event => {
    const saveButton = event.target.closest('[data-favorite]');
    if (!saveButton) return;
    const item = latestResults[Number(saveButton.dataset.favorite)];
    if (!item) return;
    const favorites = read('navigatorate.public.favorites');
    if (!favorites.some(saved => saved.name === item.name)) favorites.unshift({ name: item.name, map_url: item.map_url });
    write('navigatorate.public.favorites', favorites.slice(0, 12));
    renderSaved();
    saveButton.textContent = '★ Saved';
  });

  document.addEventListener('click', event => {
    const remove = event.target.closest('[data-unfavorite]');
    if (remove) {
      write('navigatorate.public.favorites', read('navigatorate.public.favorites').filter(item => item.name !== remove.dataset.unfavorite));
      renderSaved();
    }
    const recent = event.target.closest('[data-recent]');
    if (recent) { input.value = recent.dataset.recent; form.requestSubmit(); }
  });

  renderSaved();
})();