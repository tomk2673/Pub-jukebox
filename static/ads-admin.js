(() => {
  const $ = id => document.getElementById(id);
  let menuReady = false;
  const form = $('campaignForm');
  function setStatus(text, error = false) { $('adsStatus').textContent = text; $('adsStatus').className = error ? 'status error' : 'status success'; }
  async function api(path, options = {}) {
    const response = await fetch(path, {...options, headers: {'Content-Type': 'application/json'}});
    if (response.status === 401) { location.href = '/admin'; throw new Error('Přihlas se v administraci.'); }
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Zkontroluj vyplněné údaje a HTTPS odkaz.');
    return data;
  }
  const dateLabel = stamp => new Intl.DateTimeFormat('cs-CZ', {dateStyle: 'short', timeStyle: 'short'}).format(new Date(stamp * 1000));
  function node(tag, text, className = '') { const el = document.createElement(tag); el.textContent = text; el.className = className; return el; }
  function renderCampaign(campaign) {
    const item = document.createElement('article'); item.className = 'campaign-item';
    const stamp = Math.floor(Date.now() / 1000);
    const expired = campaign.ends_at <= stamp;
    const running = campaign.active && campaign.starts_at <= stamp && !expired;
    const state = expired ? 'UKONČENA' : campaign.active ? (running ? 'AKTIVNÍ' : 'NAPLÁNOVÁNA') : 'VYPNUTÁ / NÁVRH';
    item.append(node('div', state, 'campaign-state'), node('h3', campaign.sponsor), node('p', campaign.headline, 'small muted'));
    item.append(node('p', dateLabel(campaign.starts_at) + ' — ' + dateLabel(campaign.ends_at), 'small muted'));
    const metrics = document.createElement('div'); metrics.className = 'campaign-metrics';
    for (const [value, label] of [[campaign.impressions, 'zobrazení'], [campaign.clicks, 'prokliků']]) {
      const metric = document.createElement('div'); metric.append(node('strong', String(value)), node('span', label)); metrics.append(metric);
    }
    item.append(metrics);
    const actions = document.createElement('div'); actions.className = 'campaign-actions';
    const preview = node('a', 'Náhled ↗', 'btn secondary compact'); preview.href = '/menu?preview=' + encodeURIComponent(campaign.id); preview.target = '_blank'; preview.rel = 'noopener'; actions.append(preview);
    if (!expired || campaign.active) {
      const button = node('button', campaign.active ? 'Vypnout' : 'Spustit', 'btn compact'); button.type = 'button';
      button.disabled = !campaign.active && !menuReady;
      button.addEventListener('click', async () => {
        if (!campaign.active && !window.confirm('Spustit tuto reklamu? Nahradí současnou kampaň na nápojovém lístku.')) return;
        button.disabled = true;
        try {
          await api('/api/admin/ads/' + campaign.id + '/' + (campaign.active ? 'pause' : 'activate'), {method: 'POST', body: '{}'});
          setStatus(campaign.active ? 'Reklama je vypnutá.' : 'Kampaň je zapnutá pro zvolené období.');
          await load();
        } catch (error) { setStatus(error.message, true); button.disabled = false; }
      });
      actions.append(button);
    }
    item.append(actions); return item;
  }
  async function load() {
    const data = await api('/api/admin/ads'); menuReady = data.menu_ready;
    $('menuWarning').classList.toggle('hidden', menuReady);
    $('campaignList').replaceChildren(...data.campaigns.map(renderCampaign));
    if (!data.campaigns.length) $('campaignList').append(node('p', 'Zatím žádná kampaň. Reklamy jsou vypnuté.', 'muted'));
  }
  const localDate = value => {
    const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  form.elements.starts_at.value = localDate(Date.now());
  form.elements.ends_at.value = localDate(Date.now() + 30 * 86400000);
  form.addEventListener('submit', async event => {
    event.preventDefault(); $('saveCampaign').disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      data.starts_at = Math.floor(new Date(data.starts_at).getTime() / 1000);
      data.ends_at = Math.floor(new Date(data.ends_at).getTime() / 1000);
      if (!Number.isFinite(data.starts_at) || !Number.isFinite(data.ends_at) || data.ends_at <= data.starts_at) throw new Error('Konec musí být později než začátek.');
      await api('/api/admin/ads', {method: 'POST', body: JSON.stringify(data)});
      setStatus('Návrh je uložený. Zkontroluj náhled a potom kampaň spusť.');
      await load();
    } catch (error) { setStatus(error.message, true); }
    finally { $('saveCampaign').disabled = false; }
  });
  load().catch(error => { $('campaignList').textContent = 'Kampaně nelze načíst.'; setStatus(error.message, true); });
})();
