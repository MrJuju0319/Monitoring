const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const simpleCardTemplate = document.getElementById('simpleCardTemplate');

const summaryGrid = document.getElementById('summaryGrid');
const dataGrid = document.getElementById('dataGrid');

const mqttForm = document.getElementById('mqttForm');
const mqttServersGrid = document.getElementById('mqttServersGrid');
const snapshotInput = document.getElementById('snapshotInput');
const loadSnapshotBtn = document.getElementById('loadSnapshotBtn');
const loadDemoBtn = document.getElementById('loadDemoBtn');

const pluginForm = document.getElementById('pluginForm');
const pluginServerSelect = document.getElementById('pluginServerSelect');
const pluginsGrid = document.getElementById('pluginsGrid');

const cameraForm = document.getElementById('cameraForm');
const cameraWall = document.getElementById('cameraWall');

const STORAGE = {
  mqttServers: 'acre.mqtt.servers.v1',
  plugins: 'acre.plugins.v1',
  cameras: 'acre.cameras.v1',
  topicState: 'acre.topic.state.v1',
};

const demoSnapshot = {
  'acre_indus/zones/1/name': '1 IR Escalier RJS',
  'acre_indus/zones/1/secteur': '1 Induselec/RJS',
  'acre_indus/zones/1/state': '0',
  'acre_indus/zones/1/entree': '0',
  'acre_indus/zones/2/name': '2 IR Disney',
  'acre_indus/zones/2/secteur': '2 Disney',
  'acre_indus/zones/2/state': '0',
  'acre_indus/zones/2/entree': '0',
  'acre_indus/secteurs/0/name': 'Tous Secteurs',
  'acre_indus/secteurs/0/state': '2',
  'acre_indus/secteurs/1/name': 'Induselec/RJS',
  'acre_indus/secteurs/1/state': '0',
  'acre_indus/etat/systeme/Heure Système': 'Mer, 18 Fév 2026 15:44:21',
  'acre_indus/etat/systeme/Module Radio': 'N/A',
  'acre_indus/etat/ethernet/Adresse IP': '192.168.1.125',
  'acre_indus/etat/alimentation/Alimentation 230V': 'OK',
};

let mqttServers = loadJSON(STORAGE.mqttServers, []);
let plugins = loadJSON(STORAGE.plugins, [
  { id: crypto.randomUUID(), type: 'ACRE', name: 'Acre Indus', serverId: '', topicRoot: 'acre_indus', enabled: true },
]);
let cameras = loadJSON(STORAGE.cameras, []);
let topicState = loadJSON(STORAGE.topicState, {});

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

function mqttIcon(topic) {
  if (topic.includes('/zones/')) return '📡 Zone';
  if (topic.includes('/secteurs/')) return '🛡️ Secteur';
  if (topic.includes('/doors/')) return '🚪 Porte';
  if (topic.includes('/outputs/')) return '🔌 Sortie';
  if (topic.includes('/etat/')) return '🧠 État';
  return '📄 Topic';
}

function buildPluginData(plugin) {
  const root = `${plugin.topicRoot}/`;
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
    data[category][id][key] = payload;
  }

  return data;
}

function renderDashboard() {
  const enabledPlugins = plugins.filter((p) => p.enabled && p.type === 'ACRE');
  const decoded = enabledPlugins.map((p) => ({ plugin: p, data: buildPluginData(p) }));

  const totalTopics = Object.keys(topicState).length;
  const totalZones = decoded.reduce((acc, d) => acc + Object.keys(d.data.zones || {}).length, 0);
  const totalSecteurs = decoded.reduce((acc, d) => acc + Object.keys(d.data.secteurs || {}).length, 0);

  summaryGrid.replaceChildren(
    createCard('📡 Topics MQTT', 'Live', `${totalTopics} topic(s)`),
    createCard('🧩 Plugins actifs', 'ACRE', `${enabledPlugins.length} plugin(s)`),
    createCard('🛡️ Secteurs', 'ACRE', `${totalSecteurs} secteur(s)`),
    createCard('📟 Zones', 'ACRE', `${totalZones} zone(s)`),
  );

  const cards = [];
  for (const [topic, payload] of Object.entries(topicState).slice(0, 80)) {
    cards.push(createCard(topic, mqttIcon(topic), String(payload)));
  }
  dataGrid.replaceChildren(...cards);
}

function renderMqttServers() {
  mqttServersGrid.replaceChildren(
    ...mqttServers.map((server) => {
      const card = createCard(server.name, 'MQTT', `${server.wsUrl}`);

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
      const card = createCard(`${plugin.type} · ${plugin.name}`, plugin.enabled ? 'ON' : 'OFF', `root: ${plugin.topicRoot}\nserveur: ${server?.name || '-'}`);

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
      if (cam.webUrl) {
        const video = document.createElement('video');
        video.src = cam.webUrl;
        video.controls = true;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        zone.append(video);
      } else {
        const note = document.createElement('p');
        note.textContent = 'Flux RTSP détecté. Pour affichage web direct, configure un proxy HLS/WebRTC.';
        zone.append(note);
      }

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = 'Supprimer caméra';
      del.addEventListener('click', () => {
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
