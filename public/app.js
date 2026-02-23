const state = {
  token: localStorage.getItem('monitoring_token') || '',
  currentUser: null,
  plugins: [],
  plans: [],
  cameras: [],
  dashboard: null,
  equipment: null,
  activePlanId: null,
  editingMode: false,
  historyRangeMinutes: 60
};

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const currentUser = document.getElementById('current-user');
const editActions = document.getElementById('edit-actions');

const eventLog = document.getElementById('event-log');
const summaryCards = document.getElementById('summary-cards');
const planTabs = document.getElementById('plan-tabs');
const planCanvas = document.getElementById('plan-canvas');
const cameraGrid = document.getElementById('camera-grid');
const configPlugins = document.getElementById('config-plugins');
const configPlans = document.getElementById('config-plans');
const configCameras = document.getElementById('config-cameras');
const connectionBadge = document.getElementById('connection-status');
const pageTitle = document.getElementById('page-title');
const historyRange = document.getElementById('history-range');
const historySummary = document.getElementById('history-summary');
const equipmentCards = document.getElementById('equipment-cards');
const equipmentCameraList = document.getElementById('equipment-camera-list');
const equipmentPluginList = document.getElementById('equipment-plugin-list');
const editModeToggle = document.getElementById('edit-mode-toggle');
const savePlanButton = document.getElementById('save-plan-btn');
const configRefreshBtn = document.getElementById('config-refresh-btn');

let activeDragZoneId = null;
const rtspPlayers = new Map();
const hlsPlayers = new Map();

function isAdmin() {
  return state.currentUser?.role === 'admin';
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    logout();
    throw new Error('Session expirée');
  }
  return response;
}

function logEvent(message) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  eventLog.prepend(li);
  while (eventLog.children.length > 12) eventLog.removeChild(eventLog.lastChild);
}

function card(label, value) {
  return `<article class="card"><h3>${label}</h3><p>${value}</p></article>`;
}

function getActivePlan() {
  return state.plans.find((plan) => plan.id === state.activePlanId) || state.plans[0];
}

function showApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  currentUser.textContent = `${state.currentUser.displayName} (${state.currentUser.role})`;
  editActions.classList.toggle('hidden', !isAdmin());
}

function showLogin() {
  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
}

function logout() {
  state.token = '';
  state.currentUser = null;
  localStorage.removeItem('monitoring_token');
  showLogin();
}

async function initSession() {
  if (!state.token) return false;
  try {
    const response = await apiFetch('/api/me');
    state.currentUser = await response.json();
    showApp();
    return true;
  } catch {
    logout();
    return false;
  }
}

function renderDashboard() {
  if (!state.dashboard) return;
  const { plugins, plans, cameras, alerts } = state.dashboard;
  summaryCards.innerHTML = [
    card('Modules actifs', `${plugins.active}/${plugins.total}`),
    card('Plans', plans),
    card('Caméras online', `${cameras.online}/${cameras.total}`),
    card('Alertes critiques', alerts.critical),
    card('Alertes warning', alerts.warning)
  ].join('');
}

function zoneBadge(zone) {
  return `<div class="zone ${zone.state}" data-zone-id="${zone.id}" style="left:${zone.x}%;top:${zone.y}%">${zone.label} · ${zone.state}</div>`;
}

function renderPlans() {
  planTabs.innerHTML = state.plans
    .map((plan) => `<button class="tab-btn ${plan.id === state.activePlanId ? 'active' : ''}" data-plan-id="${plan.id}">${plan.name}</button>`)
    .join('');

  const activePlan = getActivePlan();
  if (!activePlan) {
    planCanvas.innerHTML = '<p>Aucun plan chargé.</p>';
    return;
  }

  state.activePlanId = activePlan.id;
  const planWidth = Number(activePlan.width) > 0 ? Number(activePlan.width) : 1600;
  const planHeight = Number(activePlan.height) > 0 ? Number(activePlan.height) : 900;
  planCanvas.style.aspectRatio = `${planWidth} / ${planHeight}`;
  planCanvas.style.backgroundImage = activePlan.backgroundImage ? `url(${activePlan.backgroundImage})` : '';
  planCanvas.style.backgroundSize = 'contain';
  planCanvas.style.backgroundRepeat = 'no-repeat';
  planCanvas.style.backgroundPosition = 'center';
  planCanvas.innerHTML = activePlan.zones.map(zoneBadge).join('');
  planCanvas.classList.toggle('editing', state.editingMode && isAdmin());
}

function cameraPlaybackHtml(camera) {
  const src = camera.hlsUrl || camera.streamUrl || '';
  const isRtsp = (camera.streamUrl || '').toLowerCase().startsWith('rtsp://');

  if (!src) return '<p>Flux indisponible</p>';

  if (isRtsp && camera.hlsUrl) {
    return `<video id="cam-video-${camera.id}" src="${camera.hlsUrl}" controls muted playsinline></video><p class="warning-text">Source RTSP + fallback HLS utilisé pour lecture web.</p>`;
  }

  if (isRtsp) {
    const webLive = camera.playback?.webLiveUrl || '';
    return `
      <video id="cam-video-${camera.id}" data-hls-src="${webLive}" controls muted playsinline></video>
      <p class="warning-text">RTSP converti automatiquement en flux web live (HLS).</p>
    `;
  }

  return `<video src="${src}" controls muted playsinline></video>`;
}

function destroyUnusedRtspPlayers(cameraIds) {
  for (const [id, player] of rtspPlayers.entries()) {
    if (!cameraIds.includes(id)) {
      try { player.destroy(); } catch {}
      rtspPlayers.delete(id);
    }
  }
}

function destroyUnusedHlsPlayers(cameraIds) {
  for (const [id, player] of hlsPlayers.entries()) {
    if (!cameraIds.includes(id)) {
      try {
        player.detachMedia();
        player.destroy();
      } catch {}
      hlsPlayers.delete(id);
    }
  }
}

function setupHlsPlayers() {
  const rtspCameras = state.cameras.filter((camera) => (camera.streamUrl || '').toLowerCase().startsWith('rtsp://'));
  const ids = rtspCameras.map((c) => c.id);
  destroyUnusedHlsPlayers(ids);

  for (const camera of rtspCameras) {
    const video = document.getElementById(`cam-video-${camera.id}`);
    if (!video) continue;
    const hlsSource = video.dataset.hlsSrc || camera.hlsUrl || camera.playback?.webLiveUrl;
    if (!hlsSource) continue;
    if (hlsPlayers.has(camera.id)) continue;

    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 2,
        maxLiveSyncPlaybackRate: 2,
        maxBufferLength: 2,
        maxMaxBufferLength: 4,
        lowLatencyMode: true
      });
      hls.loadSource(hlsSource);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hlsPlayers.set(camera.id, hls);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsSource;
      video.play().catch(() => {});
    }
  }
}

function setupRtspPlayers() {
  if (!window.JSMpeg) return;

  const rtspCameras = state.cameras.filter((camera) => (camera.streamUrl || '').toLowerCase().startsWith('rtsp://') && !camera.hlsUrl);
  const ids = rtspCameras.map((c) => c.id);
  destroyUnusedRtspPlayers(ids);

  for (const camera of rtspCameras) {
    if (rtspPlayers.has(camera.id)) continue;
    const canvas = document.getElementById(`rtsp-canvas-${camera.id}`);
    if (!canvas) continue;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsPath = camera.playback?.wsUrl || `/rtsp/${camera.id}?token=${encodeURIComponent(state.token)}`;
    const url = `${wsProtocol}://${window.location.host}${wsPath.startsWith('/') ? wsPath : `/${wsPath}`}`;

    try {
      const player = new window.JSMpeg.Player(url, { canvas, autoplay: true, audio: false, loop: true });
      rtspPlayers.set(camera.id, player);
    } catch {
      logEvent(`Impossible d'initialiser le flux RTSP pour ${camera.name}`);
    }
  }
}

function renderCameras() {
  const count = Math.max(1, state.cameras.length);

  cameraGrid.innerHTML = state.cameras
    .map((camera) => {
      return `<article class="camera-tile camera-count-${count}">
        <strong>${camera.name}</strong>
        <div><span class="badge ${camera.status === 'online' ? 'ok' : 'critical'}">${camera.status}</span> · ${camera.zone}</div>
        ${cameraPlaybackHtml(camera)}
      </article>`;
    })
    .join('');

  setupRtspPlayers();
  setupHlsPlayers();
}

function renderEquipment() {
  if (!state.equipment) return;
  const { cameras, plugins, sensors, mqtt } = state.equipment;
  equipmentCards.innerHTML = [
    card('Caméras en ligne', `${cameras.online}/${cameras.max}`),
    card('Plugins actifs', `${plugins.active}/${plugins.total}`),
    card('Capteurs critiques', sensors.critical),
    card('MQTT', mqtt.connected ? 'Connecté' : 'Déconnecté')
  ].join('');

  equipmentCameraList.innerHTML = cameras.items
    .map((camera) => `<li><span class="dot ${camera.status === 'online' ? 'green' : 'red'}"></span>${camera.name} <span class="badge ${camera.status === 'online' ? 'ok' : 'critical'}">${camera.status}</span></li>`)
    .join('');

  equipmentPluginList.innerHTML = plugins.items
    .map((plugin) => `<li><span class="dot ${plugin.enabled ? 'green' : 'red'}"></span>${plugin.name} <span class="badge ${plugin.enabled ? 'ok' : 'critical'}">${plugin.enabled ? 'actif' : 'inactif'}</span></li>`)
    .join('');
}

function renderHistory(historyData) {
  historySummary.innerHTML = `<span>Total: <strong>${historyData.total}</strong></span><span>OK: <strong>${historyData.byState.ok}</strong></span><span>Warning: <strong>${historyData.byState.warning}</strong></span><span>Critical: <strong>${historyData.byState.critical}</strong></span>`;
  eventLog.innerHTML = historyData.entries
    .slice()
    .reverse()
    .slice(0, 12)
    .map((entry) => `<li>${new Date(entry.timestamp).toLocaleTimeString()} · ${entry.planId}/${entry.zoneId} → ${entry.state}</li>`)
    .join('');
}

async function loadHistory() {
  const response = await apiFetch(`/api/history?minutes=${state.historyRangeMinutes}`);
  renderHistory(await response.json());
}

async function togglePlugin(id, enabled) {
  if (!isAdmin()) return;
  const response = await apiFetch(`/api/plugins/${id}/enabled`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled })
  });
  if (!response.ok) return logEvent(`Échec activation plugin ${id}`);
  logEvent(`Plugin ${id} ${enabled ? 'activé' : 'désactivé'}`);
  await loadData();
}

async function savePluginConfig(id, text) {
  if (!isAdmin()) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return alert('JSON invalide');
  }

  const response = await apiFetch(`/api/plugins/${id}/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed)
  });
  if (!response.ok) return logEvent(`Erreur configuration plugin ${id}`);
  logEvent(`Configuration du plugin ${id} mise à jour`);
  await loadData();
}

async function publishMqttValue(value) {
  if (!isAdmin()) return;
  const response = await apiFetch('/api/plugins/mqtt-io/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value })
  });
  if (!response.ok) {
    const err = await response.json();
    return logEvent(`Échec publish MQTT: ${err.error}`);
  }
  logEvent(`Valeur MQTT publiée: ${value}`);
}

async function savePlanZonesPositions() {
  if (!isAdmin()) return;
  const activePlan = getActivePlan();
  if (!activePlan) return;

  const response = await apiFetch(`/api/plans/${activePlan.id}/zones/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zones: activePlan.zones.map((zone) => ({ id: zone.id, x: zone.x, y: zone.y })) })
  });
  if (!response.ok) return logEvent('Échec sauvegarde positions capteurs');
  logEvent(`Positions capteurs sauvegardées pour ${activePlan.name}`);
  await loadData();
}

async function createPlanFromForm(name, imageInput) {
  if (!isAdmin()) return;
  const form = new FormData();
  form.append('name', name);
  if (imageInput.files?.[0]) form.append('image', imageInput.files[0]);

  const response = await apiFetch('/api/plans', {
    method: 'POST',
    body: form
  });

  if (!response.ok) return logEvent('Erreur création plan');
  logEvent(`Plan "${name}" ajouté`);
  await loadData();
}

async function savePlanMeta(planId, name, imageInput) {
  if (!isAdmin()) return;
  const form = new FormData();
  form.append('name', name);
  if (imageInput.files?.[0]) form.append('image', imageInput.files[0]);

  const response = await apiFetch(`/api/plans/${planId}`, {
    method: 'PUT',
    body: form
  });
  if (!response.ok) return logEvent('Erreur mise à jour plan');
  logEvent(`Plan ${planId} mis à jour`);
  await loadData();
}

async function createCamera(payload) {
  if (!isAdmin()) return;
  const response = await apiFetch('/api/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) return logEvent('Erreur ajout caméra');
  logEvent(`Caméra "${payload.name}" ajoutée`);
  await loadData();
}

async function updateCamera(id, payload) {
  if (!isAdmin()) return;
  const response = await apiFetch(`/api/cameras/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) return logEvent('Erreur mise à jour caméra');
  logEvent(`Caméra ${id} mise à jour`);
  await loadData();
}

function setEditingMode(enabled) {
  state.editingMode = enabled && isAdmin();
  editModeToggle.textContent = `Mode édition: ${state.editingMode ? 'ON' : 'OFF'}`;
  editModeToggle.classList.toggle('active', state.editingMode);
  planCanvas.classList.toggle('editing', state.editingMode);
}

function updateZonePositionFromPointer(clientX, clientY) {
  if (!activeDragZoneId || !state.editingMode || !isAdmin()) return;
  const rect = planCanvas.getBoundingClientRect();
  const clampedX = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
  const clampedY = Math.max(2, Math.min(98, ((clientY - rect.top) / rect.height) * 100));
  const zone = getActivePlan()?.zones.find((item) => item.id === activeDragZoneId);
  if (!zone) return;
  zone.x = clampedX;
  zone.y = clampedY;
  const zoneElement = planCanvas.querySelector(`[data-zone-id="${zone.id}"]`);
  if (zoneElement) {
    zoneElement.style.left = `${clampedX}%`;
    zoneElement.style.top = `${clampedY}%`;
  }
}

function renderPluginsConfig() {
  const readOnlyNote = isAdmin() ? '' : '<p class="readonly-note">Compte USER : visualisation uniquement (édition désactivée).</p>';
  configPlugins.innerHTML = `${readOnlyNote}${state.plugins
    .map((plugin) => {
      const mqttExtra = plugin.id === 'mqtt-io'
        ? `<div class="mqtt-grid">
            <label>Valeur à publier <input class="plugin-input" id="mqtt-publish" placeholder="0, 1, 2 ou texte" ${isAdmin() ? '' : 'disabled'} /></label>
            <button class="save" data-publish-mqtt ${isAdmin() ? '' : 'disabled'}>Publier</button>
            <div>État MQTT: <span class="badge ${plugin.runtime?.connected ? 'ok' : 'critical'}">${plugin.runtime?.connected ? 'connecté' : 'déconnecté'}</span></div>
            <div>Dernier message: ${plugin.runtime?.lastMessage ? `${plugin.runtime.lastMessage.value} ${plugin.runtime.lastMessage.unit || ''}` : 'aucun'}</div>
          </div>`
        : '';

      const visorxExtra = plugin.id === 'visorx-control'
        ? `<div class="mqtt-grid">
            <label>Index ouverture <input class="plugin-input" id="visorx-open-index" type="number" min="0" placeholder="13" ${isAdmin() ? '' : 'disabled'} /></label>
            <button class="save" data-visorx-open ${isAdmin() ? '' : 'disabled'}>Envoyer ouverture</button>
            <label>Historique pages <input class="plugin-input" id="visorx-pages" type="number" min="1" max="20" value="1" /></label>
            <button class="save" data-visorx-events>Lire événements</button>
            <pre id="visorx-events-output" class="plugin-log"></pre>
          </div>`
        : '';

      return `<article class="plugin-item">
        <div>
          <h3>${plugin.name}</h3><p>${plugin.description}</p>
          <label>Configuration JSON</label>
          <textarea id="config-${plugin.id}" ${isAdmin() ? '' : 'disabled'}>${JSON.stringify(plugin.config, null, 2)}</textarea>
          <button class="save" data-save-id="${plugin.id}" ${isAdmin() ? '' : 'disabled'}>Sauvegarder la configuration</button>
          ${mqttExtra}
          ${visorxExtra}
        </div>
        <label class="switch"><span>${plugin.enabled ? 'Activé' : 'Désactivé'}</span>
          <input type="checkbox" data-plugin-id="${plugin.id}" ${plugin.enabled ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'} />
        </label>
      </article>`;
    })
    .join('')}`;
}

function renderPlansConfig() {
  configPlans.innerHTML = `
    <div class="panel">
      <h3>Ajouter un plan</h3>
      <label>Nom du plan <input id="new-plan-name" class="plugin-input" placeholder="Ex: Entrepôt" ${isAdmin() ? '' : 'disabled'} /></label>
      <label>Image du plan <input id="new-plan-image" type="file" accept="image/*" class="plugin-input" ${isAdmin() ? '' : 'disabled'} /></label>
      <button class="save" data-create-plan ${isAdmin() ? '' : 'disabled'}>Créer le plan</button>
    </div>
    <div class="panel">
      <h3>Plans existants</h3>
      ${state.plans
        .map(
          (plan) => `
            <article class="plugin-item">
              <div>
                <label>Nom <input id="plan-name-${plan.id}" class="plugin-input" value="${plan.name}" ${isAdmin() ? '' : 'disabled'} /></label>
                <label>Image du plan (optionnel)
                  <input id="plan-image-${plan.id}" type="file" accept="image/*" class="plugin-input" ${isAdmin() ? '' : 'disabled'} />
                </label>
                <button class="save" data-save-plan="${plan.id}" ${isAdmin() ? '' : 'disabled'}>Sauvegarder ce plan</button>
              </div>
              <div>${plan.backgroundImage ? '<span class="badge ok">Image configurée</span>' : '<span class="badge warning">Pas d’image</span>'}</div>
            </article>`
        )
        .join('')}
    </div>`;
}

function cameraConfigCard(camera) {
  return `
  <article class="plugin-item">
    <div>
      <h4>${camera.name}</h4>
      <label>Nom <input id="cam-name-${camera.id}" class="plugin-input" value="${camera.name}" ${isAdmin() ? '' : 'disabled'} /></label>
      <label>Zone <input id="cam-zone-${camera.id}" class="plugin-input" value="${camera.zone || ''}" ${isAdmin() ? '' : 'disabled'} /></label>
      <label>Status
        <select id="cam-status-${camera.id}" class="plugin-input" ${isAdmin() ? '' : 'disabled'}>
          <option value="online" ${camera.status === 'online' ? 'selected' : ''}>online</option>
          <option value="offline" ${camera.status === 'offline' ? 'selected' : ''}>offline</option>
        </select>
      </label>
      <label>RTSP/URL source <input id="cam-stream-${camera.id}" class="plugin-input" value="${camera.streamUrl || ''}" ${isAdmin() ? '' : 'disabled'} /></label>
      <label>HLS/WebRTC URL (pour affichage web) <input id="cam-hls-${camera.id}" class="plugin-input" value="${camera.hlsUrl || ''}" ${isAdmin() ? '' : 'disabled'} /></label>
      <details>
        <summary>Config ONVIF</summary>
        <label>Device service URL <input id="cam-onvif-url-${camera.id}" class="plugin-input" value="${camera.onvif?.deviceServiceUrl || ''}" ${isAdmin() ? '' : 'disabled'} /></label>
        <label>ONVIF User <input id="cam-onvif-user-${camera.id}" class="plugin-input" value="${camera.onvif?.username || ''}" ${isAdmin() ? '' : 'disabled'} /></label>
        <label>ONVIF Password <input id="cam-onvif-pass-${camera.id}" class="plugin-input" value="${camera.onvif?.password || ''}" ${isAdmin() ? '' : 'disabled'} /></label>
      </details>
      <button class="save" data-save-camera="${camera.id}" ${isAdmin() ? '' : 'disabled'}>Sauvegarder caméra</button>
    </div>
    <div>${camera.streamUrl?.startsWith('rtsp://') ? '<span class="badge warning">RTSP direct non lisible web</span>' : '<span class="badge ok">Web playable</span>'}</div>
  </article>`;
}

function renderCamerasConfig() {
  configCameras.innerHTML = `
    <div class="panel">
      <h3>Ajouter une caméra</h3>
      <label>Nom <input id="new-cam-name" class="plugin-input" placeholder="Ex: Cam quai" ${isAdmin() ? '' : 'disabled'} /></label>
      <label>Zone <input id="new-cam-zone" class="plugin-input" placeholder="Ex: Quai" ${isAdmin() ? '' : 'disabled'} /></label>
      <label>RTSP/URL source <input id="new-cam-stream" class="plugin-input" placeholder="rtsp://..." ${isAdmin() ? '' : 'disabled'} /></label>
      <label>HLS URL (si RTSP utilisé) <input id="new-cam-hls" class="plugin-input" placeholder="https://...m3u8" ${isAdmin() ? '' : 'disabled'} /></label>
      <label>ONVIF device service <input id="new-cam-onvif" class="plugin-input" placeholder="http://IP/onvif/device_service" ${isAdmin() ? '' : 'disabled'} /></label>
      <button class="save" data-create-camera ${isAdmin() ? '' : 'disabled'}>Ajouter caméra</button>
    </div>
    <div class="panel"><h3>Caméras existantes</h3>${state.cameras.map(cameraConfigCard).join('')}</div>`;
}

function renderConfig() {
  renderPluginsConfig();
  renderPlansConfig();
  renderCamerasConfig();
}

async function loadData() {
  const [plugins, plans, cameras, dashboard, equipment] = await Promise.all([
    apiFetch('/api/plugins').then((r) => r.json()),
    apiFetch('/api/plans').then((r) => r.json()),
    apiFetch('/api/cameras').then((r) => r.json()),
    apiFetch('/api/dashboard').then((r) => r.json()),
    apiFetch('/api/equipment-status').then((r) => r.json())
  ]);

  state.plugins = plugins;
  state.plans = plans;
  state.cameras = cameras;
  state.dashboard = dashboard;
  state.equipment = equipment;

  if (!state.activePlanId && plans.length) state.activePlanId = plans[0].id;

  renderDashboard();
  renderPlans();
  renderCameras();
  renderEquipment();
  renderConfig();
}

async function sendVisorxOpen(index) {
  if (!isAdmin()) return;
  const response = await apiFetch('/api/plugins/visorx-control/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index: Number(index) })
  });
  const payload = await response.json();
  if (!response.ok) return logEvent(`VisorX erreur: ${payload.error || payload.statusText || 'inconnue'}`);
  logEvent(`VisorX open index ${index}: HTTP ${payload.httpCode} (${payload.statusText})`);
}

async function loadVisorxEvents(pages) {
  const response = await apiFetch(`/api/plugins/visorx-control/events?pages=${Number(pages) || 1}`);
  const output = document.getElementById('visorx-events-output');
  const payload = await response.json();
  if (!output) return;
  if (!response.ok) {
    output.textContent = payload.error || 'Erreur récupération événements';
    return;
  }
  output.textContent = payload.events
    .slice(0, 50)
    .map((event) => `${event.date} | ${event.nature} | ${event.reader} | ${event.ident} | ${event.userName || '-'}`)
    .join('\n') || 'Aucun événement';
}

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      const target = button.dataset.page;
      pageTitle.textContent = button.textContent;
      document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
      document.getElementById(target).classList.add('active');
    });
  });

  historyRange.addEventListener('change', async () => {
    state.historyRangeMinutes = Number(historyRange.value);
    await loadHistory();
  });

  editModeToggle.addEventListener('click', () => {
    if (!isAdmin()) return;
    setEditingMode(!state.editingMode);
    logEvent(`Mode édition ${state.editingMode ? 'activé' : 'désactivé'}`);
  });

  savePlanButton.addEventListener('click', savePlanZonesPositions);
  configRefreshBtn.addEventListener('click', async () => {
    await loadData();
    logEvent('Configuration rafraîchie manuellement');
  });

  planCanvas.addEventListener('pointerdown', (event) => {
    if (!state.editingMode || !isAdmin()) return;
    const zoneElement = event.target.closest('[data-zone-id]');
    if (!zoneElement) return;
    activeDragZoneId = zoneElement.dataset.zoneId;
    zoneElement.classList.add('dragging');
    zoneElement.setPointerCapture(event.pointerId);
  });

  planCanvas.addEventListener('pointermove', (event) => updateZonePositionFromPointer(event.clientX, event.clientY));
  planCanvas.addEventListener('pointerup', (event) => {
    const zoneElement = event.target.closest('[data-zone-id]');
    if (zoneElement) zoneElement.classList.remove('dragging');
    activeDragZoneId = null;
  });

  document.addEventListener('click', async (event) => {
    const planButton = event.target.closest('[data-plan-id]');
    if (planButton) {
      state.activePlanId = planButton.dataset.planId;
      return renderPlans();
    }

    const saveButton = event.target.closest('[data-save-id]');
    if (saveButton) {
      const id = saveButton.dataset.saveId;
      const input = document.getElementById(`config-${id}`);
      return savePluginConfig(id, input.value);
    }

    const publishButton = event.target.closest('[data-publish-mqtt]');
    if (publishButton) {
      const value = document.getElementById('mqtt-publish')?.value ?? '';
      return publishMqttValue(value);
    }

    const visorxOpenBtn = event.target.closest('[data-visorx-open]');
    if (visorxOpenBtn) {
      const index = document.getElementById('visorx-open-index')?.value ?? '';
      return sendVisorxOpen(index);
    }

    const visorxEventsBtn = event.target.closest('[data-visorx-events]');
    if (visorxEventsBtn) {
      const pages = document.getElementById('visorx-pages')?.value ?? '1';
      return loadVisorxEvents(pages);
    }

    const createPlanBtn = event.target.closest('[data-create-plan]');
    if (createPlanBtn) {
      const name = document.getElementById('new-plan-name').value.trim();
      const imageInput = document.getElementById('new-plan-image');
      return createPlanFromForm(name, imageInput);
    }

    const savePlanBtn = event.target.closest('[data-save-plan]');
    if (savePlanBtn) {
      const planId = savePlanBtn.dataset.savePlan;
      const name = document.getElementById(`plan-name-${planId}`).value.trim();
      const imageInput = document.getElementById(`plan-image-${planId}`);
      return savePlanMeta(planId, name, imageInput);
    }

    const createCamBtn = event.target.closest('[data-create-camera]');
    if (createCamBtn) {
      return createCamera({
        name: document.getElementById('new-cam-name').value.trim(),
        zone: document.getElementById('new-cam-zone').value.trim(),
        streamUrl: document.getElementById('new-cam-stream').value.trim(),
        hlsUrl: document.getElementById('new-cam-hls').value.trim(),
        onvif: { deviceServiceUrl: document.getElementById('new-cam-onvif').value.trim() },
        status: 'offline'
      });
    }

    const saveCamBtn = event.target.closest('[data-save-camera]');
    if (saveCamBtn) {
      const camId = saveCamBtn.dataset.saveCamera;
      return updateCamera(camId, {
        name: document.getElementById(`cam-name-${camId}`).value,
        zone: document.getElementById(`cam-zone-${camId}`).value,
        status: document.getElementById(`cam-status-${camId}`).value,
        streamUrl: document.getElementById(`cam-stream-${camId}`).value,
        hlsUrl: document.getElementById(`cam-hls-${camId}`).value,
        onvif: {
          deviceServiceUrl: document.getElementById(`cam-onvif-url-${camId}`).value,
          username: document.getElementById(`cam-onvif-user-${camId}`).value,
          password: document.getElementById(`cam-onvif-pass-${camId}`).value
        }
      });
    }

    const configTab = event.target.closest('[data-config-tab]');
    if (configTab) {
      document.querySelectorAll('[data-config-tab]').forEach((btn) => btn.classList.remove('active'));
      configTab.classList.add('active');
      const tab = configTab.dataset.configTab;
      document.querySelectorAll('.config-tab').forEach((el) => el.classList.remove('active'));
      document.getElementById(`config-${tab}`).classList.add('active');
    }
  });

  document.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-plugin-id]');
    if (checkbox) togglePlugin(checkbox.dataset.pluginId, checkbox.checked);
  });
}


function initRealtime() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws?token=${encodeURIComponent(state.token)}`);

  ws.onopen = () => {
    connectionBadge.textContent = 'Temps réel: connecté';
    connectionBadge.className = 'badge ok';
    logEvent('Connexion WebSocket établie');
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'zones:update') {
      state.plans = data.payload;
      renderPlans();
      await loadHistory();
    }
  };

  ws.onclose = () => {
    connectionBadge.textContent = 'Temps réel: déconnecté';
    connectionBadge.className = 'badge warning';
  };
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    loginError.textContent = 'Identifiants invalides';
    return;
  }

  const { token, user } = await response.json();
  state.token = token;
  state.currentUser = user;
  localStorage.setItem('monitoring_token', token);

  showApp();
  await loadData();
  await loadHistory();
  initRealtime();
});

logoutBtn.addEventListener('click', logout);

initNavigation();
initSession().then(async (ok) => {
  if (!ok) return;
  await loadData();
  await loadHistory();
  initRealtime();
});
