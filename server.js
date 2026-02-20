import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
const pluginsFile = path.join(dataDir, 'plugins.json');
const plansFile = path.join(dataDir, 'plans.json');
const camerasFile = path.join(dataDir, 'cameras.json');

const MAX_HISTORY_POINTS = 10000;
const sensorHistory = [];

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
  sensorHistory.push({
    timestamp: Date.now(),
    planId,
    zoneId,
    state
  });

  if (sensorHistory.length > MAX_HISTORY_POINTS) {
    sensorHistory.splice(0, sensorHistory.length - MAX_HISTORY_POINTS);
  }
}

function broadcast(wss, type, payload) {
  const message = JSON.stringify({
    type,
    timestamp: Date.now(),
    payload
  });

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/plugins', async (_, res) => {
  const plugins = await readJson(pluginsFile);
  res.json(plugins);
});

app.patch('/api/plugins/:id/enabled', async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled doit être un booléen' });
  }

  const plugins = await readJson(pluginsFile);
  const plugin = plugins.find((item) => item.id === id);

  if (!plugin) {
    return res.status(404).json({ error: 'Plugin introuvable' });
  }

  plugin.enabled = enabled;
  await writeJson(pluginsFile, plugins);
  return res.json(plugin);
});

app.put('/api/plugins/:id/config', async (req, res) => {
  const { id } = req.params;
  const incomingConfig = req.body;

  if (!incomingConfig || typeof incomingConfig !== 'object' || Array.isArray(incomingConfig)) {
    return res.status(400).json({ error: 'config invalide' });
  }

  const plugins = await readJson(pluginsFile);
  const plugin = plugins.find((item) => item.id === id);

  if (!plugin) {
    return res.status(404).json({ error: 'Plugin introuvable' });
  }

  plugin.config = { ...plugin.config, ...incomingConfig };
  await writeJson(pluginsFile, plugins);
  return res.json(plugin);
});

app.get('/api/plans', async (_, res) => {
  const plans = await readJson(plansFile);
  res.json(plans);
});

app.post('/api/plans/:id/zones/positions', async (req, res) => {
  const { id } = req.params;
  const { zones } = req.body;

  if (!Array.isArray(zones)) {
    return res.status(400).json({ error: 'zones doit être un tableau' });
  }

  const plans = await readJson(plansFile);
  const plan = plans.find((item) => item.id === id);

  if (!plan) {
    return res.status(404).json({ error: 'Plan introuvable' });
  }

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

app.get('/api/cameras', async (_, res) => {
  const cameras = await readJson(camerasFile);
  res.json(cameras);
});

app.get('/api/history', (req, res) => {
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

  res.json({
    rangeMinutes: safeMinutes,
    total: entries.length,
    byState,
    entries: entries.slice(-250)
  });
});

app.get('/api/equipment-status', async (_, res) => {
  const [plugins, cameras, plans] = await Promise.all([
    readJson(pluginsFile),
    readJson(camerasFile),
    readJson(plansFile)
  ]);

  const cameraDetails = cameras.map((camera) => ({
    id: camera.id,
    name: camera.name,
    status: camera.status
  }));

  const sensorStates = plans.flatMap((plan) => plan.zones).reduce(
    (acc, zone) => {
      acc.total += 1;
      acc[zone.state] = (acc[zone.state] ?? 0) + 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0 }
  );

  res.json({
    cameras: {
      online: cameraDetails.filter((item) => item.status === 'online').length,
      max: cameraDetails.length,
      items: cameraDetails
    },
    plugins: {
      active: plugins.filter((plugin) => plugin.enabled).length,
      total: plugins.length,
      items: plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        enabled: plugin.enabled
      }))
    },
    sensors: sensorStates
  });
});

app.get('/api/dashboard', async (_, res) => {
  const plugins = await readJson(pluginsFile);
  const plans = await readJson(plansFile);
  const cameras = await readJson(camerasFile);

  const onlineCameras = cameras.filter((camera) => camera.status === 'online').length;
  const zones = plans.flatMap((plan) => plan.zones);

  res.json({
    plugins: getPluginSummary(plugins),
    plans: plans.length,
    cameras: {
      total: cameras.length,
      online: onlineCameras,
      offline: cameras.length - onlineCameras
    },
    alerts: {
      critical: zones.filter((zone) => zone.state === 'critical').length,
      warning: zones.filter((zone) => zone.state === 'warning').length
    }
  });
});

const server = app.listen(port, () => {
  console.log(`Monitoring app running on http://localhost:${port}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws) => {
  const [plugins, plans, cameras] = await Promise.all([
    readJson(pluginsFile),
    readJson(plansFile),
    readJson(camerasFile)
  ]);

  ws.send(
    JSON.stringify({
      type: 'snapshot',
      timestamp: Date.now(),
      payload: { plugins, plans, cameras }
    })
  );
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

      if (zone.state !== previousState) {
        pushSensorHistory(plan.id, zone.id, zone.state);
      }
    }
  }

  await writeJson(plansFile, plans);
  broadcast(wss, 'zones:update', plans);
}, 3000);
