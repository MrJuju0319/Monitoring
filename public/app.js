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
const configModules = document.getElementById('config-modules');
const connectionBadge = document.getElementById('connection-status');
const pageTitle = document.getElementById('page-title');
const historyRange = document.getElementById('history-range');
const historySummary = document.getElementById('history-summary');
const equipmentCards = document.getElementById('equipment-cards');
const equipmentCameraList = document.getElementById('equipment-camera-list');
const equipmentPluginList = document.getElementById('equipment-plugin-list');
const editModeToggle = document.getElementById('edit-mode-toggle');
const savePlanButton = document.getElementById('save-plan-btn');

let activeDragZoneId = null;

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
  planCanvas.innerHTML = activePlan.zones.map(zoneBadge).join('');
  planCanvas.classList.toggle('editing', state.editingMode && isAdmin());
}

function renderCameras() {
  cameraGrid.innerHTML = state.cameras
    .map((camera) => {
      const media = camera.status === 'online' && camera.streamUrl ? `<video src="${camera.streamUrl}" controls muted></video>` : '<p>Flux indisponible</p>';
      return `<article class="camera-tile"><strong>${camera.name}</strong><div><span class="badge ${camera.status === 'online' ? 'ok' : 'critical'}">${camera.status}</span> · ${camera.zone}</div>${media}</article>`;
    })
    .join('');
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
  try { parsed = JSON.parse(text); } catch { return alert('JSON invalide'); }

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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zones: activePlan.zones.map((zone) => ({ id: zone.id, x: zone.x, y: zone.y })) })
  });
  if (!response.ok) return logEvent('Échec sauvegarde positions capteurs');
  logEvent(`Positions capteurs sauvegardées pour ${activePlan.name}`);
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

function renderConfig() {
  const readOnlyNote = isAdmin() ? '' : '<p class="readonly-note">Compte USER : visualisation uniquement (édition désactivée).</p>';
  configModules.innerHTML = `${readOnlyNote}${state.plugins
    .map((plugin) => {
      const mqttExtra = plugin.id === 'mqtt-io'
        ? `<div class="mqtt-grid">
            <label>Valeur à publier <input class="plugin-input" id="mqtt-publish" placeholder="0, 1, 2 ou texte" ${isAdmin() ? '' : 'disabled'} /></label>
            <button class="save" data-publish-mqtt ${isAdmin() ? '' : 'disabled'}>Publier</button>
            <div>État MQTT: <span class="badge ${plugin.runtime?.connected ? 'ok' : 'critical'}">${plugin.runtime?.connected ? 'connecté' : 'déconnecté'}</span></div>
            <div>Dernier message: ${plugin.runtime?.lastMessage ? `${plugin.runtime.lastMessage.value} ${plugin.runtime.lastMessage.unit || ''}` : 'aucun'}</div>
          </div>`
        : '';

      return `<article class="plugin-item">
        <div>
          <h3>${plugin.name}</h3><p>${plugin.description}</p>
          <label>Configuration JSON</label>
          <textarea id="config-${plugin.id}" ${isAdmin() ? '' : 'disabled'}>${JSON.stringify(plugin.config, null, 2)}</textarea>
          <button class="save" data-save-id="${plugin.id}" ${isAdmin() ? '' : 'disabled'}>Sauvegarder la configuration</button>
          ${mqttExtra}
        </div>
        <label class="switch"><span>${plugin.enabled ? 'Activé' : 'Désactivé'}</span>
          <input type="checkbox" data-plugin-id="${plugin.id}" ${plugin.enabled ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'} />
        </label>
      </article>`;
    })
    .join('')}`;
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

  document.addEventListener('click', (event) => {
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
      await loadData();
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
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
  setInterval(loadHistory, 10000);
});
