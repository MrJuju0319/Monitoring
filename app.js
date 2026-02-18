const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const simpleCardTemplate = document.getElementById('simpleCardTemplate');

const summaryGrid = document.getElementById('summaryGrid');
const decodedGrid = document.getElementById('decodedGrid');
const dataGrid = document.getElementById('dataGrid');

const mqttForm = document.getElementById('mqttForm');
const mqttServersGrid = document.getElementById('mqttServersGrid');
const snapshotInput = document.getElementById('snapshotInput');
const loadSnapshotBtn = document.getElementById('loadSnapshotBtn');
const loadDemoBtn = document.getElementById('loadDemoBtn');
const clearTopicsBtn = document.getElementById('clearTopicsBtn');

const pluginForm = document.getElementById('pluginForm');
const pluginServerSelect = document.getElementById('pluginServerSelect');
const pluginsGrid = document.getElementById('pluginsGrid');

const gatewayApiInput = document.getElementById('gatewayApiInput');
const cameraForm = document.getElementById('cameraForm');
const cameraWall = document.getElementById('cameraWall');

const STORAGE = {
  mqttServers: 'acre.mqtt.servers.v2',
  plugins: 'acre.plugins.v2',
  cameras: 'acre.cameras.v2',
  topicState: 'acre.topic.state.v2',
  gatewayApi: 'acre.gateway.api.v1',
};

const demoSnapshot = {
  'acre_indus/zones/1/name': '1 IR Escalier RJS',
  'acre_indus/zones/1/secteur': '1 Induselec/RJS',
  'acre_indus/zones/1/state': '0',
  'acre_indus/zones/1/entree': '0',
  'acre_indus/zones/2/name': '2 IR Disney',
  'acre_indus/zones/2/secteur': '2 Disney',
  'acre_indus/zones/2/state': '1',
  'acre_indus/zones/2/entree': '1',
  'acre_indus/secteurs/0/name': 'Tous Secteurs',
  'acre_indus/secteurs/0/state': '2',
  'acre_indus/secteurs/1/name': 'Induselec/RJS',
  'acre_indus/secteurs/1/state': '0',
  'acre_indus/secteurs/2/name': 'Disney',
  'acre_indus/secteurs/2/state': '1',
  'acre_indus/etat/systeme/Heure Système': 'Mer, 18 Fév 2026 15:44:21',
  'acre_indus/etat/ethernet/Adresse IP': '192.168.1.125',
  'acre_indus/etat/alimentation/Alimentation 230V': 'OK',
};

let mqttServers = loadJSON(STORAGE.mqttServers, []);
let plugins = loadJSON(STORAGE.plugins, []);
if (!plugins.length) {
  plugins = [{ id: crypto.randomUUID(), type: 'ACRE', name: 'Acre Indus', serverId: '', topicRoot: 'acre_indus', enabled: true }];
}
let cameras = loadJSON(STORAGE.cameras, []);
let topicState = loadJSON(STORAGE.topicState, {});
let gatewayApi = localStorage.getItem(STORAGE.gatewayApi) || 'http://127.0.0.1:8787';

const mqttClients = new Map();

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function switchTab(tabKey) {
  tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabKey));
  panels.forEach((panel) => panel.classList.toggle('active', panel.id === tabKey));
}

function createCard(title, badge, meta) {
  const node = simpleCardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('.title').textContent = title;
  node.querySelector('.badge').textContent = badge;
  node.querySelector('.meta').textContent = meta;
  return node;
}

function labelZoneState(state) {
  if (String(state) === '0') return 'Normal';
  if (String(state) === '1') return 'Alarme';
  return String(state);
}

function labelEntreeState(state) {
  const map = { '0': 'Fermée', '1': 'Ouverte', '2': 'Isolée', '3': 'Inhibée' };
  return map[String(state)] || String(state);
}

function labelSecteurState(state) {
  const map = { '0': 'MHS', '1': 'MES totale', '2': 'Nuit', '3': 'MES partielle B', '4': 'Alarme' };
  return map[String(state)] || String(state);
}

function mqttIcon(topic) {
  if (topic.includes('/zones/')) return '📡 Zone';
  if (topic.includes('/secteurs/')) return '🛡️ Secteur';
  if (topic.includes('/doors/')) return '🚪 Porte';
  if (topic.includes('/outputs/')) return '🔌 Sortie';
  if (topic.includes('/etat/')) return '🧠 État';
  return '📄 Topic';
}

function buildPluginData(plugin) {
  const root = `${plugin.topicRoot.replace(/\/+$/, '')}/`;
  const entries = Object.entries(topicState).filter(([topic]) => topic.startsWith(root));

  const data = { zones: {}, secteurs: {}, doors: {}, outputs: {}, etat: {} };

  for (const [topic, payload] of entries) {
    const sub = topic.slice(root.length).split('/');
    const [category, id, ...rest] = sub;
    if (!category) continue;

    if (category === 'etat') {
      const section = id || 'global';
      const key = rest.join('/') || 'value';
      data.etat[section] = data.etat[section] || {};
      data.etat[section][key] = payload;
      continue;
    }

    if (!id) continue;
    data[category] = data[category] || {};
    data[category][id] = data[category][id] || {};
    const key = rest.join('/') || 'value';

    let parsedValue = payload;
    if (typeof payload === 'string') {
      const trimmed = payload.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          parsedValue = JSON.parse(trimmed);
        } catch {
          parsedValue = payload;
        }
      }
    }
    data[category][id][key] = parsedValue;
  }

  return data;
}

function renderDashboard() {
  const enabledPlugins = plugins.filter((p) => p.enabled && p.type === 'ACRE');
  const decoded = enabledPlugins.map((p) => ({ plugin: p, data: buildPluginData(p) }));

  const totalTopics = Object.keys(topicState).length;
  const totalZones = decoded.reduce((acc, d) => acc + Object.keys(d.data.zones || {}).length, 0);
  const totalSecteurs = decoded.reduce((acc, d) => acc + Object.keys(d.data.secteurs || {}).length, 0);
  const totalEtatLines = decoded.reduce((acc, d) => acc + Object.values(d.data.etat || {}).reduce((s, section) => s + Object.keys(section).length, 0), 0);

  summaryGrid.replaceChildren(
    createCard('📡 Topics MQTT', 'Live', `${totalTopics} topic(s)`),
    createCard('🧩 Plugins actifs', 'ACRE', `${enabledPlugins.length} plugin(s)`),
    createCard('🛡️ Secteurs', 'ACRE', `${totalSecteurs} secteur(s)`),
    createCard('📟 Zones', 'ACRE', `${totalZones} zone(s)`),
    createCard('🧠 État contrôleur', 'ACRE', `${totalEtatLines} valeur(s)`),
  );

  const decodedCards = [];
  for (const item of decoded) {
    const { plugin, data } = item;

    for (const [zoneId, zone] of Object.entries(data.zones || {})) {
      decodedCards.push(
        createCard(
          `📡 ${plugin.name} · Zone ${zoneId} ${zone.name || ''}`.trim(),
          'ZONE',
          `secteur=${zone.secteur || '-'} · état=${labelZoneState(zone.state)} · entrée=${labelEntreeState(zone.entree)}`,
        ),
      );
    }

    for (const [sid, sec] of Object.entries(data.secteurs || {})) {
      decodedCards.push(
        createCard(
          `🛡️ ${plugin.name} · Secteur ${sid} ${sec.name || ''}`.trim(),
          'SECTEUR',
          `état=${labelSecteurState(sec.state)}`,
        ),
      );
    }

    for (const [sectionName, sectionValues] of Object.entries(data.etat || {})) {
      const valueText = Object.entries(sectionValues)
        .slice(0, 10)
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ');
      decodedCards.push(createCard(`🧠 ${plugin.name} · ${sectionName}`, 'ÉTAT', valueText || '-'));
    }
  }
  decodedGrid.replaceChildren(...decodedCards.slice(0, 120));

  const rawCards = [];
  for (const [topic, payload] of Object.entries(topicState)) {
    rawCards.push(createCard(topic, mqttIcon(topic), String(payload)));
  }
  dataGrid.replaceChildren(...rawCards.slice(0, 200));
}

function renderMqttServers() {
  mqttServersGrid.replaceChildren(
    ...mqttServers.map((server) => {
      const card = createCard(server.name, mqttClients.has(server.id) ? 'CONNECTÉ' : 'MQTT', `${server.wsUrl}`);

      const row = document.createElement('div');
      row.className = 'row-actions';

      const connectBtn = document.createElement('button');
      connectBtn.type = 'button';
      connectBtn.textContent = mqttClients.has(server.id) ? 'Déconnecter' : 'Connecter';
      connectBtn.addEventListener('click', () => {
        if (mqttClients.has(server.id)) disconnectServer(server.id);
        else connectServer(server.id);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'danger';
      deleteBtn.textContent = 'Supprimer';
      deleteBtn.addEventListener('click', () => {
        disconnectServer(server.id);
        mqttServers = mqttServers.filter((s) => s.id !== server.id);
        saveJSON(STORAGE.mqttServers, mqttServers);
        renderMqttServers();
        renderPluginServerSelect();
      });

      row.append(connectBtn, deleteBtn);
      card.append(row);
      return card;
    }),
  );
}

function renderPluginServerSelect() {
  pluginServerSelect.replaceChildren();
  for (const server of mqttServers) {
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = `${server.name} (${server.wsUrl})`;
    pluginServerSelect.append(option);
  }
}

function renderPlugins() {
  pluginsGrid.replaceChildren(
    ...plugins.map((plugin) => {
      const server = mqttServers.find((s) => s.id === plugin.serverId);
      const card = createCard(`${plugin.type} · ${plugin.name}`, plugin.enabled ? 'ON' : 'OFF', `root=${plugin.topicRoot}\nserveur=${server?.name || '-'}`);

      const row = document.createElement('div');
      row.className = 'row-actions';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'secondary';
      toggleBtn.textContent = plugin.enabled ? 'Désactiver' : 'Activer';
      toggleBtn.addEventListener('click', () => {
        plugin.enabled = !plugin.enabled;
        saveJSON(STORAGE.plugins, plugins);
        renderPlugins();
        renderDashboard();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Supprimer';
      delBtn.addEventListener('click', () => {
        plugins = plugins.filter((p) => p.id !== plugin.id);
        saveJSON(STORAGE.plugins, plugins);
        renderPlugins();
        renderDashboard();
      });

      row.append(toggleBtn, delBtn);
      card.append(row);
      return card;
    }),
  );
}

async function ensureGatewayCamera(cam) {
  if (cam.webUrl) return cam.webUrl;
  const api = gatewayApi.replace(/\/+$/, '');
  try {
    const response = await fetch(`${api}/api/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: cam.id, rtsp_url: cam.rtspUrl }),
    });
    if (!response.ok) throw new Error('gateway error');
    const data = await response.json();
    cam.webUrl = data.hls_url;
    saveJSON(STORAGE.cameras, cameras);
    return cam.webUrl;
  } catch {
    return '';
  }
}

function renderCameras() {
  cameraWall.replaceChildren(
    ...cameras.map((cam) => {
      const wrap = document.createElement('article');
      wrap.className = 'card camera-card';

      const h = document.createElement('h3');
      h.className = 'title';
      h.textContent = `🎥 ${cam.name}`;

      const rtsp = document.createElement('p');
      rtsp.className = 'meta';
      rtsp.textContent = `RTSP: ${cam.rtspUrl}`;

      const zone = document.createElement('div');
      zone.className = 'camera-feed';

      const info = document.createElement('p');
      info.className = 'meta';
      info.textContent = 'Initialisation flux...';
      zone.append(info);

      ensureGatewayCamera(cam).then((hlsUrl) => {
        zone.replaceChildren();
        if (!hlsUrl) {
          const note = document.createElement('p');
          note.className = 'meta';
          note.textContent = 'Impossible de créer le flux auto. Lance gateway_server.py puis réessaie.';
          zone.append(note);
          return;
        }

        const video = document.createElement('video');
        video.src = hlsUrl;
        video.controls = true;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        zone.append(video);
      });

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = 'Supprimer caméra';
      del.addEventListener('click', async () => {
        const api = gatewayApi.replace(/\/+$/, '');
        try {
          await fetch(`${api}/api/cameras/${cam.id}`, { method: 'DELETE' });
        } catch {
          // ignore
        }
        cameras = cameras.filter((c) => c.id !== cam.id);
        saveJSON(STORAGE.cameras, cameras);
        renderCameras();
      });
      actions.append(del);

      wrap.append(h, rtsp, zone, actions);
      return wrap;
    }),
  );
}

function updateTopic(topic, payload) {
  topicState[topic] = payload;
  saveJSON(STORAGE.topicState, topicState);
  renderDashboard();
}

function connectServer(serverId) {
  const server = mqttServers.find((s) => s.id === serverId);
  if (!server) return;

  if (!window.mqtt) {
    alert('Librairie MQTT non chargée (mqtt.min.js).');
    return;
  }

  const client = window.mqtt.connect(server.wsUrl, {
    username: server.username || undefined,
    password: server.password || undefined,
    reconnectPeriod: 3000,
  });

  client.on('connect', () => {
    client.subscribe('#');
    renderMqttServers();
  });

  client.on('message', (topic, message) => {
    updateTopic(topic, message.toString());
  });

  client.on('error', () => {
    renderMqttServers();
  });

  mqttClients.set(serverId, client);
  renderMqttServers();
}

function disconnectServer(serverId) {
  const client = mqttClients.get(serverId);
  if (!client) return;
  client.end(true);
  mqttClients.delete(serverId);
  renderMqttServers();
}

tabs.forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

mqttForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(mqttForm);

  mqttServers.unshift({
    id: crypto.randomUUID(),
    name: String(formData.get('name')),
    wsUrl: String(formData.get('wsUrl')),
    username: String(formData.get('username') || ''),
    password: String(formData.get('password') || ''),
  });

  saveJSON(STORAGE.mqttServers, mqttServers);
  mqttForm.reset();
  renderMqttServers();
  renderPluginServerSelect();
});

loadSnapshotBtn.addEventListener('click', () => {
  try {
    const parsed = JSON.parse(snapshotInput.value);
    topicState = parsed;
    saveJSON(STORAGE.topicState, topicState);
    renderDashboard();
  } catch {
    alert('JSON snapshot invalide.');
  }
});

loadDemoBtn.addEventListener('click', () => {
  snapshotInput.value = JSON.stringify(demoSnapshot, null, 2);
  topicState = structuredClone(demoSnapshot);
  saveJSON(STORAGE.topicState, topicState);
  renderDashboard();
});

clearTopicsBtn.addEventListener('click', () => {
  topicState = {};
  saveJSON(STORAGE.topicState, topicState);
  renderDashboard();
});

pluginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(pluginForm);

  plugins.unshift({
    id: crypto.randomUUID(),
    type: String(formData.get('type')),
    name: String(formData.get('name')),
    serverId: String(formData.get('serverId') || ''),
    topicRoot: String(formData.get('topicRoot')),
    enabled: true,
  });

  saveJSON(STORAGE.plugins, plugins);
  pluginForm.reset();
  renderPlugins();
  renderDashboard();
});

gatewayApiInput.value = gatewayApi;
gatewayApiInput.addEventListener('change', () => {
  gatewayApi = gatewayApiInput.value.trim() || 'http://127.0.0.1:8787';
  localStorage.setItem(STORAGE.gatewayApi, gatewayApi);
  renderCameras();
});

cameraForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(cameraForm);

  cameras.unshift({
    id: crypto.randomUUID(),
    name: String(formData.get('name')),
    rtspUrl: String(formData.get('rtspUrl')),
    webUrl: String(formData.get('webUrl') || ''),
  });

  saveJSON(STORAGE.cameras, cameras);
  cameraForm.reset();
  renderCameras();
});

if (mqttServers.length && plugins.length && !plugins[0].serverId) {
  plugins[0].serverId = mqttServers[0].id;
  saveJSON(STORAGE.plugins, plugins);
}

renderPluginServerSelect();
renderMqttServers();
renderPlugins();
renderCameras();
renderDashboard();
