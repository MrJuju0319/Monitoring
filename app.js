const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');

const pluginForm = document.getElementById('pluginForm');
const pluginGrid = document.getElementById('pluginGrid');
const summaryGrid = document.getElementById('summaryGrid');
const allDataGrid = document.getElementById('allDataGrid');
const simpleCardTemplate = document.getElementById('simpleCardTemplate');

const exporterForm = document.getElementById('exporterForm');
const exportConfigBtn = document.getElementById('exportConfigBtn');
const configJson = document.getElementById('configJson');

const dataJson = document.getElementById('dataJson');
const loadDataBtn = document.getElementById('loadDataBtn');
const loadSampleBtn = document.getElementById('loadSampleBtn');

const planImageInput = document.getElementById('planImageInput');
const planCanvas = document.getElementById('planCanvas');
const overlayForm = document.getElementById('overlayForm');
const overlayList = document.getElementById('overlayList');

const LOCAL_CONFIG_KEY = 'acre.monitoring.exporter.config.v1';
const LOCAL_DATA_KEY = 'acre.monitoring.exporter.data.v1';
const LOCAL_OVERLAYS_KEY = 'acre.monitoring.exporter.overlays.v1';

const plugins = [
  { pluginType: 'RTSP', pluginName: 'Caméra Entrée', endpoint: 'rtsp://camera-entree.local/live' },
  { pluginType: 'Hikvision', pluginName: 'Caméra Stockage', endpoint: 'hikvision://192.168.1.40' },
];

const defaultConfig = {
  spcHost: 'https://spc.local',
  spcUser: 'installateur',
  mqttHost: '127.0.0.1',
  mqttPort: 1883,
  baseTopic: 'spc',
  refresh: 2,
  information: {
    zones: true,
    secteurs: true,
    doors: true,
    outputs: true,
  },
};

const sampleData = {
  zones: [
    { id: '1', zone: '1 Entrée', etat: 0, etat_txt: 'Normal', entree: 0, entree_txt: 'Fermée' },
    { id: '2', zone: '2 Stockage', etat: 1, etat_txt: 'Alarme', entree: 1, entree_txt: 'Ouverte' },
  ],
  areas: [
    { sid: '1', nom: 'Bâtiment A', etat: 1, etat_txt: 'MES totale' },
    { sid: '2', nom: 'Bâtiment B', etat: 0, etat_txt: 'MHS' },
  ],
  doors: [
    { id: '1', door: 'Porte Accueil', etat: 0, etat_txt: 'Normale', drs: 0, drs_txt: 'Fermée' },
  ],
  outputs: [
    { id: '1', name: 'Sirène 1', state: 0, state_txt: 'Off' },
    { id: '2', name: 'Lumière Alarme', state: 1, state_txt: 'On' },
  ],
  controller: [
    {
      slug: 'systeme',
      title: 'Système',
      values: { status: 'OK', version: '4.2.1' },
      labels: { status: 'Status', version: 'Version' },
    },
  ],
};

let exporterConfig = loadJSON(LOCAL_CONFIG_KEY, defaultConfig);
let exporterData = loadJSON(LOCAL_DATA_KEY, sampleData);
let overlays = loadJSON(LOCAL_OVERLAYS_KEY, []);
let currentPlanImage = null;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
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

function renderPlugins() {
  pluginGrid.replaceChildren(
    ...plugins.map((plugin) =>
      createCard(plugin.pluginName, plugin.pluginType, `Endpoint: ${plugin.endpoint}`),
    ),
  );
}

function renderSummary() {
  const zones = exporterData.zones?.length ?? 0;
  const areas = exporterData.areas?.length ?? 0;
  const doors = exporterData.doors?.length ?? 0;
  const outputs = exporterData.outputs?.length ?? 0;
  const controller = exporterData.controller?.length ?? 0;

  summaryGrid.replaceChildren(
    createCard('Zones', 'SPC', `${zones} élément(s)`),
    createCard('Secteurs', 'SPC', `${areas} élément(s)`),
    createCard('Portes', 'SPC', `${doors} élément(s)`),
    createCard('Sorties', 'SPC', `${outputs} élément(s)`),
    createCard('Controller', 'SPC', `${controller} section(s)`),
  );
}

function renderAllData() {
  const cards = [];

  for (const zone of exporterData.zones || []) {
    cards.push(
      createCard(
        `Zone ${zone.id || ''} ${zone.zone || ''}`.trim(),
        'zone',
        `etat=${zone.etat_txt || zone.etat} · entrée=${zone.entree_txt || zone.entree}`,
      ),
    );
  }

  for (const area of exporterData.areas || []) {
    cards.push(
      createCard(
        `Secteur ${area.sid || ''} ${area.nom || ''}`.trim(),
        'area',
        `etat=${area.etat_txt || area.etat}`,
      ),
    );
  }

  for (const door of exporterData.doors || []) {
    cards.push(
      createCard(
        `Porte ${door.id || ''} ${door.door || ''}`.trim(),
        'door',
        `etat=${door.etat_txt || door.etat} · drs=${door.drs_txt || door.drs}`,
      ),
    );
  }

  for (const output of exporterData.outputs || []) {
    cards.push(
      createCard(
        `Sortie ${output.id || ''} ${output.name || ''}`.trim(),
        'output',
        `state=${output.state_txt || output.state}`,
      ),
    );
  }

  for (const ctrl of exporterData.controller || []) {
    const values = ctrl.values || {};
    cards.push(createCard(`Controller ${ctrl.title || ctrl.slug || ''}`, 'controller', JSON.stringify(values)));
  }

  allDataGrid.replaceChildren(...cards);
}

function getByCategory(category) {
  if (category === 'areas') return exporterData.areas || [];
  if (category === 'zones') return exporterData.zones || [];
  if (category === 'doors') return exporterData.doors || [];
  if (category === 'outputs') return exporterData.outputs || [];
  if (category === 'controller') return exporterData.controller || [];
  return [];
}

function resolveField(obj, fieldPath) {
  const parts = String(fieldPath || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function resolveOverlayValue(overlay) {
  const list = getByCategory(overlay.category);
  const key = String(overlay.key || '').toLowerCase();
  const match = list.find((item) => {
    const candidates = [
      item.id,
      item.sid,
      item.zone,
      item.nom,
      item.name,
      item.slug,
      item.door,
      item.interaction,
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    return candidates.includes(key);
  });

  if (!match) return '[introuvable]';
  const value = resolveField(match, overlay.field);
  if (value === undefined) return '[champ inconnu]';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderPlan() {
  planCanvas.innerHTML = '';

  if (!currentPlanImage) {
    const placeholder = document.createElement('p');
    placeholder.className = 'plan-placeholder';
    placeholder.textContent = 'Charge une image pour afficher les informations dessus.';
    planCanvas.append(placeholder);
    return;
  }

  const image = document.createElement('img');
  image.src = currentPlanImage;
  image.className = 'plan-image';
  image.alt = 'Plan utilisateur';
  planCanvas.append(image);

  overlays.forEach((overlay) => {
    const marker = document.createElement('div');
    marker.className = 'overlay-item';
    marker.style.left = `${overlay.x}%`;
    marker.style.top = `${overlay.y}%`;
    marker.textContent = `${overlay.category}:${overlay.key} → ${resolveOverlayValue(overlay)}`;
    planCanvas.append(marker);
  });
}

function renderOverlayList() {
  overlayList.replaceChildren(
    ...overlays.map((overlay, index) => {
      const card = createCard(
        `Overlay #${index + 1}`,
        overlay.category,
        `${overlay.key} · ${overlay.field} · (${overlay.x}%, ${overlay.y}%)`,
      );

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'danger';
      removeBtn.textContent = 'Supprimer';
      removeBtn.addEventListener('click', () => {
        overlays = overlays.filter((_, idx) => idx !== index);
        saveJSON(LOCAL_OVERLAYS_KEY, overlays);
        renderOverlayList();
        renderPlan();
      });

      card.append(removeBtn);
      return card;
    }),
  );
}

function syncConfigUI() {
  exporterForm.spcHost.value = exporterConfig.spcHost || '';
  exporterForm.spcUser.value = exporterConfig.spcUser || '';
  exporterForm.mqttHost.value = exporterConfig.mqttHost || '';
  exporterForm.mqttPort.value = exporterConfig.mqttPort || 1883;
  exporterForm.baseTopic.value = exporterConfig.baseTopic || 'spc';
  exporterForm.refresh.value = exporterConfig.refresh || 2;

  exporterForm.infoZones.checked = !!exporterConfig.information?.zones;
  exporterForm.infoSecteurs.checked = !!exporterConfig.information?.secteurs;
  exporterForm.infoDoors.checked = !!exporterConfig.information?.doors;
  exporterForm.infoOutputs.checked = !!exporterConfig.information?.outputs;

  configJson.value = JSON.stringify(exporterConfig, null, 2);
  dataJson.value = JSON.stringify(exporterData, null, 2);
}

tabs.forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

pluginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(pluginForm);
  plugins.unshift({
    pluginType: formData.get('pluginType'),
    pluginName: formData.get('pluginName'),
    endpoint: formData.get('endpoint'),
  });
  pluginForm.reset();
  renderPlugins();
});

exporterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(exporterForm);

  exporterConfig = {
    spcHost: String(formData.get('spcHost')),
    spcUser: String(formData.get('spcUser')),
    mqttHost: String(formData.get('mqttHost')),
    mqttPort: Number(formData.get('mqttPort')),
    baseTopic: String(formData.get('baseTopic')),
    refresh: Number(formData.get('refresh')),
    information: {
      zones: formData.get('infoZones') === 'on',
      secteurs: formData.get('infoSecteurs') === 'on',
      doors: formData.get('infoDoors') === 'on',
      outputs: formData.get('infoOutputs') === 'on',
    },
  };

  saveJSON(LOCAL_CONFIG_KEY, exporterConfig);
  configJson.value = JSON.stringify(exporterConfig, null, 2);
});

exportConfigBtn.addEventListener('click', () => {
  configJson.value = JSON.stringify(exporterConfig, null, 2);
});

loadDataBtn.addEventListener('click', () => {
  try {
    const parsed = JSON.parse(dataJson.value);
    exporterData = parsed;
    saveJSON(LOCAL_DATA_KEY, exporterData);
    renderSummary();
    renderAllData();
    renderPlan();
  } catch {
    alert('JSON invalide');
  }
});

loadSampleBtn.addEventListener('click', () => {
  exporterData = structuredClone(sampleData);
  dataJson.value = JSON.stringify(exporterData, null, 2);
  saveJSON(LOCAL_DATA_KEY, exporterData);
  renderSummary();
  renderAllData();
  renderPlan();
});

planImageInput.addEventListener('change', () => {
  const [file] = planImageInput.files || [];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    currentPlanImage = String(reader.result || '');
    renderPlan();
  };
  reader.readAsDataURL(file);
});

overlayForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(overlayForm);

  overlays.push({
    category: String(formData.get('category')),
    key: String(formData.get('key')),
    field: String(formData.get('field')),
    x: Number(formData.get('x')),
    y: Number(formData.get('y')),
  });

  saveJSON(LOCAL_OVERLAYS_KEY, overlays);
  overlayForm.reset();
  renderOverlayList();
  renderPlan();
});

syncConfigUI();
renderPlugins();
renderSummary();
renderAllData();
renderOverlayList();
renderPlan();
