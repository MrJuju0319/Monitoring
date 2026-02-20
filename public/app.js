const state = {
  plugins: [],
  plans: [],
  cameras: [],
  dashboard: null,
  activePlanId: null
};

const eventLog = document.getElementById('event-log');
const summaryCards = document.getElementById('summary-cards');
const planTabs = document.getElementById('plan-tabs');
const planCanvas = document.getElementById('plan-canvas');
const cameraGrid = document.getElementById('camera-grid');
const configModules = document.getElementById('config-modules');
const connectionBadge = document.getElementById('connection-status');
const pageTitle = document.getElementById('page-title');

function logEvent(message) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  eventLog.prepend(li);
  while (eventLog.children.length > 12) eventLog.removeChild(eventLog.lastChild);
}

function card(label, value) {
  return `<article class="card"><h3>${label}</h3><p>${value}</p></article>`;
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
  return `<div class="zone ${zone.state}" style="left:${zone.x}%;top:${zone.y}%">${zone.label} · ${zone.state}</div>`;
}

function renderPlans() {
  planTabs.innerHTML = state.plans
    .map(
      (plan) =>
        `<button class="tab-btn ${plan.id === state.activePlanId ? 'active' : ''}" data-plan-id="${plan.id}">${plan.name}</button>`
    )
    .join('');

  const activePlan = state.plans.find((plan) => plan.id === state.activePlanId) || state.plans[0];
  if (!activePlan) {
    planCanvas.innerHTML = '<p>Aucun plan chargé.</p>';
    return;
  }

  state.activePlanId = activePlan.id;
  planCanvas.innerHTML = activePlan.zones.map(zoneBadge).join('');
}

function renderCameras() {
  cameraGrid.innerHTML = state.cameras
    .map((camera) => {
      const media = camera.status === 'online' && camera.streamUrl
        ? `<video src="${camera.streamUrl}" controls muted></video>`
        : '<p>Flux indisponible</p>';
      return `
      <article class="camera-tile">
        <strong>${camera.name}</strong>
        <div><span class="badge ${camera.status === 'online' ? 'ok' : 'critical'}">${camera.status}</span> · ${camera.zone}</div>
        ${media}
      </article>`;
    })
    .join('');
}

async function togglePlugin(id, enabled) {
  const response = await fetch(`/api/plugins/${id}/enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });

  if (!response.ok) {
    logEvent(`Échec activation plugin ${id}`);
    return;
  }

  logEvent(`Plugin ${id} ${enabled ? 'activé' : 'désactivé'}`);
  await loadData();
}

async function savePluginConfig(id, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert('JSON invalide');
    return;
  }

  const response = await fetch(`/api/plugins/${id}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed)
  });

  if (!response.ok) {
    logEvent(`Erreur configuration plugin ${id}`);
    return;
  }

  logEvent(`Configuration du plugin ${id} mise à jour`);
  await loadData();
}

function renderConfig() {
  configModules.innerHTML = state.plugins
    .map(
      (plugin) => `
        <article class="plugin-item">
          <div>
            <h3>${plugin.name}</h3>
            <p>${plugin.description}</p>
            <label>Configuration JSON</label>
            <textarea id="config-${plugin.id}">${JSON.stringify(plugin.config, null, 2)}</textarea>
            <button class="save" data-save-id="${plugin.id}">Sauvegarder la configuration</button>
          </div>
          <label class="switch">
            <span>${plugin.enabled ? 'Activé' : 'Désactivé'}</span>
            <input type="checkbox" data-plugin-id="${plugin.id}" ${plugin.enabled ? 'checked' : ''} />
          </label>
        </article>
      `
    )
    .join('');
}

async function loadData() {
  const [plugins, plans, cameras, dashboard] = await Promise.all([
    fetch('/api/plugins').then((r) => r.json()),
    fetch('/api/plans').then((r) => r.json()),
    fetch('/api/cameras').then((r) => r.json()),
    fetch('/api/dashboard').then((r) => r.json())
  ]);

  state.plugins = plugins;
  state.plans = plans;
  state.cameras = cameras;
  state.dashboard = dashboard;

  if (!state.activePlanId && plans.length) state.activePlanId = plans[0].id;

  renderDashboard();
  renderPlans();
  renderCameras();
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

  document.addEventListener('click', (event) => {
    const planButton = event.target.closest('[data-plan-id]');
    if (planButton) {
      state.activePlanId = planButton.dataset.planId;
      renderPlans();
      return;
    }

    const saveButton = event.target.closest('[data-save-id]');
    if (saveButton) {
      const id = saveButton.dataset.saveId;
      const input = document.getElementById(`config-${id}`);
      savePluginConfig(id, input.value);
      return;
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
    if (!checkbox) return;
    togglePlugin(checkbox.dataset.pluginId, checkbox.checked);
  });
}

function initRealtime() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws`);

  ws.onopen = () => {
    connectionBadge.textContent = 'Temps réel: connecté';
    connectionBadge.className = 'badge ok';
    logEvent('Connexion WebSocket établie');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'zones:update') {
      state.plans = data.payload;
      renderPlans();
      logEvent('Mise à jour temps réel des plans');
    }
  };

  ws.onclose = () => {
    connectionBadge.textContent = 'Temps réel: déconnecté';
    connectionBadge.className = 'badge warning';
    logEvent('Connexion WebSocket fermée');
  };
}

initNavigation();
loadData().then(() => {
  logEvent('Interface initialisée');
  initRealtime();
});
