(() => {
  const $ = id => document.getElementById(id);
  function renderMenu(text) {
    const root = $('drinkMenu');
    root.replaceChildren();
    let section;
    for (const line of text.split('\n').map(value => value.trim()).filter(Boolean)) {
      if (!line.includes('|')) {
        section = document.createElement('section');
        section.className = 'drink-section';
        const title = document.createElement('h2');
        title.textContent = line;
        section.append(title);
        root.append(section);
      } else {
        if (!section) { section = document.createElement('section'); section.className = 'drink-section'; root.append(section); }
        const [name, ...price] = line.split('|');
        const row = document.createElement('div');
        row.className = 'drink-row';
        const label = document.createElement('span'); label.textContent = name.trim();
        const amount = document.createElement('strong'); amount.className = 'drink-price'; amount.textContent = price.join('|').trim();
        row.append(label, amount); section.append(row);
      }
    }
    if (!text.trim()) root.textContent = 'Aktuální nabídku ti řekne obsluha.';
  }
  function renderSponsor(ad) {
    if (!ad) return;
    const url = new URL(ad.target_url);
    if (url.protocol !== 'https:') return;
    $('sponsorName').textContent = ad.sponsor;
    $('sponsorHeadline').textContent = ad.headline;
    $('sponsorBody').textContent = ad.body;
    $('sponsorLink').textContent = ad.cta + ' ↗';
    $('sponsorLink').href = url.href;
    $('sponsorHost').textContent = url.hostname;
    $('sponsorCard').classList.remove('hidden');
    if (ad.preview) { $('previewLabel').classList.remove('hidden'); return; }
    if (!ad.event_token) return;
    const report = kind => fetch('/api/ads/event', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({token: ad.event_token, kind}), keepalive: true,
    }).catch(() => {}); // Metrics must never delay an advertiser link or the menu.
    $('sponsorLink').addEventListener('click', () => report('click'));
    if (!window.IntersectionObserver) return;
    let visible = false, timer = null, sent = false;
    const schedule = () => {
      clearTimeout(timer);
      if (!sent && visible && !document.hidden) {
        timer = setTimeout(() => { sent = true; report('impression'); observer.disconnect(); }, 1000);
      }
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.5;
      schedule();
    }, {threshold: [0, 0.5]});
    observer.observe($('sponsorCard'));
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('pagehide', () => { clearTimeout(timer); observer.disconnect(); });
  }
  async function boot() {
    try {
      const params = new URLSearchParams(location.search);
      const preview = params.get('preview');
      const response = await fetch('/api/menu' + (preview ? '?preview=' + encodeURIComponent(preview) : ''), {cache: 'no-store'});
      if (response.status === 401 || response.status === 403) { location.href = '/guest'; return; }
      if (!response.ok) throw new Error('Nabídku se nepodařilo načíst. Zkus obnovit stránku.');
      const data = await response.json();
      $('menuVenue').textContent = data.business_name;
      renderMenu(data.menu_text);
      renderSponsor(data.sponsor);
      $('menuStatus').textContent = '';
    } catch (error) { $('menuStatus').textContent = error.message; }
  }
  boot();
})();
