import express from 'express';
import { WebSocketServer } from 'ws';
import mqtt from 'mqtt';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const pluginsFile = path.join(dataDir, 'plugins.json');
const plansFile = path.join(dataDir, 'plans.json');
const camerasFile = path.join(dataDir, 'cameras.json');

const JWT_SECRET = process.env.JWT_SECRET || 'monitoring-super-secret';
const MAX_HISTORY_POINTS = 10000;
const sensorHistory = [];

const mqttState = {
  connected: false,
  lastMessage: null,
  lastError: null,
  client: null,
  currentConfigSignature: null
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function readJson(file) {
  const content = await fs.readFile(file, 'utf-8');
  return JSON.parse(content);
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function getPluginSummary(plugins) {
  const total = plugins.length;
  const active = plugins.filter((plugin) => plugin.enabled).length;
  return { total, active, inactive: total - active };
}

function pushSensorHistory(planId, zoneId, state) {
  sensorHistory.push({ timestamp: Date.now(), planId, zoneId, state });
  if (sensorHistory.length > MAX_HISTORY_POINTS) {
    sensorHistory.splice(0, sensorHistory.length - MAX_HISTORY_POINTS);
  }
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  req.user = payload;
  return next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Action réservée à un administrateur' });
  }
  return next();
}

function parseMqttValue(rawValue, dataType) {
  const valueText = rawValue.toString('utf-8').trim();

  if (dataType === 'binary') {
    const normalized = valueText === '1' || valueText.toLowerCase() === 'true' ? 1 : 0;
    return { raw: valueText, value: normalized, type: 'binary' };
  }

  if (dataType === 'numeric') {
    const num = Number(valueText);
    const bounded = Number.isFinite(num) ? Math.max(0, Math.min(4, num)) : 0;
    return { raw: valueText, value: bounded, type: 'numeric' };
  }

  return { raw: valueText, value: valueText, type: 'text' };
}

async function getMqttPlugin() {
  const plugins = await readJson(pluginsFile);
  return plugins.find((plugin) => plugin.id === 'mqtt-io');
}

async function setupMqttClientIfNeeded() {
  const mqttPlugin = await getMqttPlugin();
  if (!mqttPlugin || !mqttPlugin.enabled) {
    if (mqttState.client) mqttState.client.end(true);
    mqttState.client = null;
    mqttState.connected = false;
    mqttState.currentConfigSignature = null;
    return;
  }

  const cfg = mqttPlugin.config || {};
  const signature = JSON.stringify({
    brokerUrl: cfg.brokerUrl,
    subscribeTopic: cfg.subscribeTopic,
    publishTopic: cfg.publishTopic,
    dataType: cfg.dataType,
    username: cfg.username,
    password: cfg.password,
    qos: cfg.qos,
    retain: cfg.retain,
    unit: cfg.unit
  });

  if (mqttState.client && mqttState.currentConfigSignature === signature) return;

  if (mqttState.client) mqttState.client.end(true);

  const client = mqtt.connect(cfg.brokerUrl, {
    username: cfg.username || undefined,
    password: cfg.password || undefined,
    reconnectPeriod: 2000
  });

  mqttState.client = client;
  mqttState.currentConfigSignature = signature;

  client.on('connect', () => {
    mqttState.connected = true;
    mqttState.lastError = null;
    client.subscribe(cfg.subscribeTopic, { qos: Number(cfg.qos) || 0 }, (err) => {
      if (err) mqttState.lastError = err.message;
    });
  });

  client.on('error', (err) => {
    mqttState.lastError = err.message;
  });

  client.on('close', () => {
    mqttState.connected = false;
  });

  client.on('message', (topic, payloadBuffer) => {
    const parsed = parseMqttValue(payloadBuffer, cfg.dataType || 'text');
    mqttState.lastMessage = {
      topic,
      ...parsed,
      unit: cfg.unit || '',
      timestamp: Date.now()
    };
  });
}

function broadcast(wss, type, payload) {
  const message = JSON.stringify({ type, timestamp: Date.now(), payload });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const users = await readJson(usersFile);
  const user = users.find((item) => item.username === username && item.password === password);

  if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

  const token = signToken({
    sub: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    exp: Date.now() + 24 * 60 * 60 * 1000
  });

  return res.json({ token, user: { username: user.username, role: user.role, displayName: user.displayName } });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, displayName: req.user.displayName });
});

app.get('/api/plugins', authRequired, async (_, res) => {
  const plugins = await readJson(pluginsFile);
  const enriched = plugins.map((plugin) =>
    plugin.id === 'mqtt-io'
      ? {
          ...plugin,
          runtime: {
            connected: mqttState.connected,
            lastMessage: mqttState.lastMessage,
            lastError: mqttState.lastError
          }
        }
      : plugin
  );
  res.json(enriched);
});

app.patch('/api/plugins/:id/enabled', authRequired, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled doit être un booléen' });
  }

  const plugins = await readJson(pluginsFile);
  const plugin = plugins.find((item) => item.id === id);
  if (!plugin) return res.status(404).json({ error: 'Plugin introuvable' });

  plugin.enabled = enabled;
  await writeJson(pluginsFile, plugins);
  await setupMqttClientIfNeeded();
  return res.json(plugin);
});

app.put('/api/plugins/:id/config', authRequired, adminOnly, async (req, res) => {
  const { id } = req.params;
  const incomingConfig = req.body;

  if (!incomingConfig || typeof incomingConfig !== 'object' || Array.isArray(incomingConfig)) {
    return res.status(400).json({ error: 'config invalide' });
  }

  const plugins = await readJson(pluginsFile);
  const plugin = plugins.find((item) => item.id === id);
  if (!plugin) return res.status(404).json({ error: 'Plugin introuvable' });

  plugin.config = { ...plugin.config, ...incomingConfig };
  await writeJson(pluginsFile, plugins);
  await setupMqttClientIfNeeded();
  return res.json(plugin);
});

app.post('/api/plugins/:id/publish', authRequired, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { value } = req.body;
  if (id !== 'mqtt-io') return res.status(400).json({ error: 'Publication disponible uniquement pour mqtt-io' });

  const plugin = await getMqttPlugin();
  if (!plugin?.enabled) return res.status(400).json({ error: 'Plugin MQTT inactif' });
  if (!mqttState.client || !mqttState.connected) return res.status(400).json({ error: 'MQTT non connecté' });

  const cfg = plugin.config || {};
  mqttState.client.publish(
    cfg.publishTopic,
    String(value ?? ''),
    { qos: Number(cfg.qos) || 0, retain: Boolean(cfg.retain) },
    (err) => {
      if (err) mqttState.lastError = err.message;
    }
  );

  return res.json({ ok: true, topic: cfg.publishTopic, value: String(value ?? '') });
});

app.get('/api/plans', authRequired, async (_, res) => {
  const plans = await readJson(plansFile);
  res.json(plans);
});

app.post('/api/plans/:id/zones/positions', authRequired, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { zones } = req.body;
  if (!Array.isArray(zones)) return res.status(400).json({ error: 'zones doit être un tableau' });

  const plans = await readJson(plansFile);
  const plan = plans.find((item) => item.id === id);
  if (!plan) return res.status(404).json({ error: 'Plan introuvable' });

  for (const zoneUpdate of zones) {
    if (!zoneUpdate.id || typeof zoneUpdate.x !== 'number' || typeof zoneUpdate.y !== 'number') {
      return res.status(400).json({ error: 'zone invalide: id, x, y requis' });
    }
    const zone = plan.zones.find((item) => item.id === zoneUpdate.id);
    if (!zone) continue;
    zone.x = Math.max(2, Math.min(98, zoneUpdate.x));
    zone.y = Math.max(2, Math.min(98, zoneUpdate.y));
  }

  await writeJson(plansFile, plans);
  return res.json(plan);
});

app.get('/api/cameras', authRequired, async (_, res) => {
  const cameras = await readJson(camerasFile);
  res.json(cameras);
});

app.get('/api/history', authRequired, (req, res) => {
  const minutes = Number(req.query.minutes ?? 60);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 1440) : 60;
  const cutoff = Date.now() - safeMinutes * 60 * 1000;
  const entries = sensorHistory.filter((entry) => entry.timestamp >= cutoff);
  const byState = entries.reduce(
    (acc, entry) => {
      acc[entry.state] = (acc[entry.state] ?? 0) + 1;
      return acc;
    },
    { ok: 0, warning: 0, critical: 0 }
  );

  res.json({ rangeMinutes: safeMinutes, total: entries.length, byState, entries: entries.slice(-250) });
});

app.get('/api/equipment-status', authRequired, async (_, res) => {
  const [plugins, cameras, plans] = await Promise.all([readJson(pluginsFile), readJson(camerasFile), readJson(plansFile)]);
  const cameraDetails = cameras.map((camera) => ({ id: camera.id, name: camera.name, status: camera.status }));

  const sensorStates = plans.flatMap((plan) => plan.zones).reduce(
    (acc, zone) => {
      acc.total += 1;
      acc[zone.state] = (acc[zone.state] ?? 0) + 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0 }
  );

  res.json({
    cameras: { online: cameraDetails.filter((item) => item.status === 'online').length, max: cameraDetails.length, items: cameraDetails },
    plugins: {
      active: plugins.filter((plugin) => plugin.enabled).length,
      total: plugins.length,
      items: plugins.map((plugin) => ({ id: plugin.id, name: plugin.name, enabled: plugin.enabled }))
    },
    sensors: sensorStates,
    mqtt: {
      connected: mqttState.connected,
      lastMessage: mqttState.lastMessage,
      lastError: mqttState.lastError
    }
  });
});

app.get('/api/dashboard', authRequired, async (_, res) => {
  const plugins = await readJson(pluginsFile);
  const plans = await readJson(plansFile);
  const cameras = await readJson(camerasFile);
  const onlineCameras = cameras.filter((camera) => camera.status === 'online').length;
  const zones = plans.flatMap((plan) => plan.zones);

  res.json({
    plugins: getPluginSummary(plugins),
    plans: plans.length,
    cameras: { total: cameras.length, online: onlineCameras, offline: cameras.length - onlineCameras },
    alerts: {
      critical: zones.filter((zone) => zone.state === 'critical').length,
      warning: zones.filter((zone) => zone.state === 'warning').length
    }
  });
});

const server = app.listen(port, async () => {
  await setupMqttClientIfNeeded();
  console.log(`Monitoring app running on http://localhost:${port}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
  const reqUrl = new URL(req.url || '/ws', `http://${req.headers.host}`);
  const token = reqUrl.searchParams.get('token');
  const payload = verifyToken(token);

  if (!payload) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  const [plugins, plans, cameras] = await Promise.all([readJson(pluginsFile), readJson(plansFile), readJson(camerasFile)]);
  ws.send(JSON.stringify({ type: 'snapshot', timestamp: Date.now(), payload: { plugins, plans, cameras } }));
});

setInterval(async () => {
  const plans = await readJson(plansFile);

  for (const plan of plans) {
    for (const zone of plan.zones) {
      const previousState = zone.state;
      const random = Math.random();
      if (random > 0.93) zone.state = 'critical';
      else if (random > 0.78) zone.state = 'warning';
      else zone.state = 'ok';

      if (zone.state !== previousState) pushSensorHistory(plan.id, zone.id, zone.state);
    }
  }

  await writeJson(plansFile, plans);
  broadcast(wss, 'zones:update', plans);
}, 3000);
