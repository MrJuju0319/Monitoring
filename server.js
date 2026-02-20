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

app.get('/api/cameras', async (_, res) => {
  const cameras = await readJson(camerasFile);
  res.json(cameras);
});

app.get('/api/dashboard', async (_, res) => {
  const plugins = await readJson(pluginsFile);
  const plans = await readJson(plansFile);
  const cameras = await readJson(camerasFile);

  const onlineCameras = cameras.filter((camera) => camera.status === 'online').length;
  const criticalZones = plans.flatMap((plan) => plan.zones).filter((zone) => zone.state === 'critical').length;

  res.json({
    plugins: getPluginSummary(plugins),
    plans: plans.length,
    cameras: {
      total: cameras.length,
      online: onlineCameras,
      offline: cameras.length - onlineCameras
    },
    alerts: {
      critical: criticalZones,
      warning: plans.flatMap((plan) => plan.zones).filter((zone) => zone.state === 'warning').length
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
      const random = Math.random();
      if (random > 0.93) zone.state = 'critical';
      else if (random > 0.78) zone.state = 'warning';
      else zone.state = 'ok';
    }
  }

  await writeJson(plansFile, plans);

  const payload = {
    type: 'zones:update',
    timestamp: Date.now(),
    payload: plans
  };

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(JSON.stringify(payload));
    }
  }
}, 3000);
