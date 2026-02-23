import express from 'express';
import { WebSocketServer } from 'ws';
import mqtt from 'mqtt';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const pluginsFile = path.join(dataDir, 'plugins.json');
const plansFile = path.join(dataDir, 'plans.json');
const camerasFile = path.join(dataDir, 'cameras.json');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const liveDir = path.join(__dirname, 'public', 'live');

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


const rtspRelayState = new Map();
const rtspWebState = new Map();

function getCameraRelay(cameraId) {
  if (!rtspRelayState.has(cameraId)) {
    rtspRelayState.set(cameraId, {
      ffmpeg: null,
      clients: new Set(),
      startedAt: 0,
      status: 'idle',
      lastError: null
    });
  }
  return rtspRelayState.get(cameraId);
}

async function getRtspRelayConfig() {
  const plugins = await readJson(pluginsFile);
  const plugin = plugins.find((item) => item.id === 'rtsp-relay');
  const defaults = {
    enabled: true,
    ffmpegPath: 'ffmpeg',
    width: 960,
    height: 540,
    fps: 15,
    bitrateKbps: 1200,
    transport: 'tcp'
  };

  if (!plugin) return defaults;
  return { ...defaults, ...(plugin.config || {}), enabled: plugin.enabled !== false };
}

async function startRtspRelay(cameraId, rtspUrl) {
  const relay = getCameraRelay(cameraId);
  if (relay.ffmpeg) return relay;

  const cfg = await getRtspRelayConfig();
  if (!cfg.enabled) {
    relay.status = 'disabled';
    relay.lastError = 'Plugin rtsp-relay désactivé';
    return relay;
  }

  const ffmpegArgs = [
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-rtsp_transport', cfg.transport || 'tcp',
    '-i', rtspUrl,
    '-an',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-vf', `scale=${cfg.width || 960}:${cfg.height || 540}`,
    '-r', String(cfg.fps || 15),
    '-b:v', `${cfg.bitrateKbps || 1200}k`,
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    '-'
  ];

  relay.ffmpeg = spawn(cfg.ffmpegPath || 'ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  relay.startedAt = Date.now();
  relay.status = 'starting';
  relay.lastError = null;

  relay.ffmpeg.stdout.on('data', (chunk) => {
    relay.status = 'streaming';
    for (const client of relay.clients) {
      if (client.readyState === 1) client.send(chunk);
    }
  });

  relay.ffmpeg.stderr.on('data', (chunk) => {
    const msg = chunk.toString();
    if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fail')) {
      relay.lastError = msg.slice(0, 500);
    }
  });

  relay.ffmpeg.on('close', (code) => {
    relay.status = 'stopped';
    if (code !== 0 && !relay.lastError) relay.lastError = `ffmpeg fermé avec code ${code}`;
    relay.ffmpeg = null;
  });

  return relay;
}

function stopRtspRelayIfUnused(cameraId) {
  const relay = getCameraRelay(cameraId);
  if (relay.clients.size === 0 && relay.ffmpeg) {
    relay.ffmpeg.kill('SIGTERM');
    relay.ffmpeg = null;
    relay.status = 'idle';
  }
}

function getRtspWeb(cameraId) {
  if (!rtspWebState.has(cameraId)) {
    rtspWebState.set(cameraId, {
      ffmpeg: null,
      status: 'idle',
      lastError: null,
      startedAt: 0,
      lastAccess: 0
    });
  }
  return rtspWebState.get(cameraId);
}

function normalizeRtspUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed.toLowerCase().startsWith('rtsp://')) return trimmed;

  let normalized = trimmed;
  normalized = normalized.replace(/\/:([0-9]{2,5})(?=\/|$|\?)/, ':$1');
  normalized = normalized.replace(/^rtsp:\/\//i, 'rtsp://');
  return normalized;
}

async function ensureLiveDir() {
  await fs.mkdir(liveDir, { recursive: true });
}

async function startRtspWebConverter(cameraId, rtspUrl) {
  const normalizedRtsp = normalizeRtspUrl(rtspUrl);
  const relay = getRtspWeb(cameraId);
  relay.lastAccess = Date.now();
  if (relay.ffmpeg) return relay;

  const cfg = await getRtspRelayConfig();
  if (!cfg.enabled) {
    relay.status = 'disabled';
    relay.lastError = 'Plugin rtsp-relay désactivé';
    return relay;
  }

  await ensureLiveDir();
  const cameraLiveDir = path.join(liveDir, cameraId);
  await fs.mkdir(cameraLiveDir, { recursive: true });
  const outputPath = path.join(cameraLiveDir, 'index.m3u8');

  const ffmpegArgs = [
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-use_wallclock_as_timestamps', '1',
    '-rtsp_transport', cfg.transport || 'tcp',
    '-i', normalizedRtsp,
    '-an',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-vf', `scale=${cfg.width || 960}:${cfg.height || 540}`,
    '-r', String(cfg.fps || 15),
    '-b:v', `${cfg.bitrateKbps || 1200}k`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-g', String(Math.max(10, Number(cfg.fps || 15))),
    '-keyint_min', String(Math.max(10, Number(cfg.fps || 15))),
    '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', '0.5',
    '-hls_list_size', '2',
    '-hls_flags', 'delete_segments+append_list+independent_segments+omit_endlist+split_by_time+program_date_time',
    '-hls_segment_filename', path.join(cameraLiveDir, 'seg_%06d.ts'),
    outputPath
  ];

  try {
    relay.ffmpeg = spawn(cfg.ffmpegPath || 'ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    relay.status = 'error';
    relay.lastError = error.message;
    relay.ffmpeg = null;
    return relay;
  }
  relay.startedAt = Date.now();
  relay.status = 'starting';
  relay.lastError = null;

  relay.ffmpeg.on('error', (error) => {
    relay.status = 'error';
    relay.lastError = error.message;
    relay.ffmpeg = null;
  });

  relay.ffmpeg.stderr.on('data', (chunk) => {
    const msg = chunk.toString();
    if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fail')) relay.lastError = msg.slice(0, 500);
    if (msg.includes('Opening') || msg.includes('.ts')) relay.status = 'streaming';
  });

  relay.ffmpeg.on('close', (code) => {
    relay.status = 'stopped';
    if (code !== 0 && !relay.lastError) relay.lastError = `ffmpeg fermé avec code ${code}`;
    relay.ffmpeg = null;
  });

  return relay;
}

function stopRtspWebConverter(cameraId) {
  const relay = getRtspWeb(cameraId);
  if (relay.ffmpeg) {
    relay.ffmpeg.kill('SIGTERM');
    relay.ffmpeg = null;
    relay.status = 'idle';
  }
}

async function syncRtspWebConverters() {
  const cameras = await readJson(camerasFile);
  const rtspCameras = cameras
    .map((camera) => ({ ...camera, streamUrl: normalizeRtspUrl(camera.streamUrl || '') }))
    .filter((camera) => (camera.streamUrl || '').toLowerCase().startsWith('rtsp://'));
  const ids = new Set(rtspCameras.map((camera) => camera.id));

  for (const camera of rtspCameras) {
    await startRtspWebConverter(camera.id, camera.streamUrl);
  }

  for (const [cameraId] of rtspWebState.entries()) {
    if (!ids.has(cameraId)) stopRtspWebConverter(cameraId);
  }
}

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use('/live', express.static(liveDir));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function readJson(file) {
  const content = await fs.readFile(file, 'utf-8');
  return JSON.parse(content);
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function ensureUploadsDir() {
  await fs.mkdir(uploadsDir, { recursive: true });
}

async function saveImageAsJpg(fileBuffer, prefix = 'plan') {
  await ensureUploadsDir();
  const fileName = `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`;
  const absolutePath = path.join(uploadsDir, fileName);

  const info = await sharp(fileBuffer)
    .rotate()
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(absolutePath);

  return { url: `/uploads/${fileName}`, width: info.width || 1600, height: info.height || 900 };
}

function buildVisorxConfig(config = {}) {
  return {
    scheme: config.scheme === 'https' ? 'https' : 'http',
    host: (config.host || '').trim(),
    user: String(config.user || '').trim(),
    code: String(config.code || '').trim(),
    openPath: config.openPath || '/FR/open.cgi',
    eventsPath: config.eventsPath || '/FR/GetEvenements.cgi',
    timeoutSeconds: Number(config.timeoutSeconds) > 0 ? Math.min(Number(config.timeoutSeconds), 25) : 8,
    natureMap: typeof config.natureMap === 'object' && config.natureMap ? config.natureMap : {},
    readerMap: typeof config.readerMap === 'object' && config.readerMap ? config.readerMap : {},
    userMap: typeof config.userMap === 'object' && config.userMap ? config.userMap : {}
  };
}

async function runCurl(args) {
  const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = await once(child, 'close');
  return { code: Number(code), stdout, stderr };
}

function parseVisorxEvents(rawBody, maps = {}) {
  const chunks = String(rawBody || '').split('#');
  const events = [];

  for (const chunk of chunks) {
    const value = chunk.trim();
    if (!value || /^\d+$/.test(value)) continue;
    const parts = value.split('$');
    if (parts.length < 5) continue;

    const [date, natureId, readerId, ident, personId] = parts;
    const nature = maps.natureMap?.[natureId] || natureId;
    const reader = maps.readerMap?.[readerId] || readerId;
    const userName = maps.userMap?.[ident] || '';

    events.push({ date, natureId, nature, readerId, reader, ident, personId, userName });
  }

  return events;
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
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

  if (!payload) return res.status(401).json({ error: 'Authentification requise' });
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

function detectCameraPlayback(camera) {
  const source = camera.hlsUrl || camera.streamUrl || '';
  if (!source) {
    return { canPlayDirectly: false, reason: 'Aucune URL de flux configurée', recommendedUrl: '' };
  }

  const lower = source.toLowerCase();
  if (lower.startsWith('rtsp://')) {
    return {
      canPlayDirectly: false,
      reason: 'RTSP n’est pas lisible directement par les navigateurs. Le convertisseur web live (HLS) sera utilisé automatiquement.',
      recommendedUrl: camera.hlsUrl || '',
      mode: 'rtsp-converter'
    };
  }

  return { canPlayDirectly: true, reason: '', recommendedUrl: source };
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
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled doit être un booléen' });

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

app.post('/api/plugins/visorx-control/open', authRequired, adminOnly, async (req, res) => {
  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'index invalide' });

  const plugins = await readJson(pluginsFile);
  const plugin = plugins.find((item) => item.id === 'visorx-control');
  if (!plugin?.enabled) return res.status(400).json({ error: 'Plugin visorx-control inactif' });

  const cfg = buildVisorxConfig(plugin.config);
  if (!cfg.host || !cfg.user || !cfg.code) return res.status(400).json({ error: 'Configuration VisorX incomplète (host/user/code)' });

  const url = `${cfg.scheme}://${cfg.host}${cfg.openPath}?index=${index}`;
  const result = await runCurl([
    '-sS',
    '--digest',
    '-u', `${cfg.user}:${cfg.code}`,
    '-o', '/dev/null',
    '-w', '%{http_code}',
    '--max-time', String(cfg.timeoutSeconds),
    url
  ]);

  const httpCode = (result.stdout || '000').trim() || '000';
  let statusText = 'Error';
  let success = false;

  if (/^2\d\d$/.test(httpCode)) {
    statusText = 'OK';
    success = true;
  } else if (/^3\d\d$/.test(httpCode)) {
    statusText = 'Redirection (possible succès)';
    success = true;
  } else if (httpCode === '401' || httpCode === '403') {
    statusText = 'Auth failed';
  } else if (httpCode === '000') {
    statusText = 'Curl failed or timeout';
  }

  res.status(success ? 200 : 502).json({ ok: success, httpCode, statusText, url });
});

app.get('/api/plugins/visorx-control/events', authRequired, async (req, res) => {
  const pages = Number(req.query.pages ?? 1);
  const safePages = Number.isFinite(pages) && pages > 0 ? Math.min(pages, 20) : 1;

  const plugins = await readJson(pluginsFile);
  const plugin = plugins.find((item) => item.id === 'visorx-control');
  if (!plugin?.enabled) return res.status(400).json({ error: 'Plugin visorx-control inactif' });

  const cfg = buildVisorxConfig(plugin.config);
  if (!cfg.host || !cfg.user || !cfg.code) return res.status(400).json({ error: 'Configuration VisorX incomplète (host/user/code)' });

  const allEvents = [];
  for (let idx = 0; idx < safePages; idx += 1) {
    const url = `${cfg.scheme}://${cfg.host}${cfg.eventsPath}?index=${idx}`;
    const result = await runCurl([
      '-sS',
      '--digest',
      '-u', `${cfg.user}:${cfg.code}`,
      '--max-time', String(cfg.timeoutSeconds),
      url
    ]);

    if (result.code !== 0 || !result.stdout.trim()) break;
    const events = parseVisorxEvents(result.stdout, cfg);
    if (!events.length) break;
    allEvents.push(...events);
  }

  res.json({ pages: safePages, total: allEvents.length, events: allEvents });
});

app.get('/api/plans', authRequired, async (_, res) => {
  const plans = await readJson(plansFile);
  res.json(plans);
});

app.post('/api/plans', authRequired, adminOnly, upload.single('image'), async (req, res) => {
  const name = req.body.name;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name requis' });

  const plans = await readJson(plansFile);
  let backgroundImage = '';
  let width = 1600;
  let height = 900;

  if (req.file?.buffer) {
    try {
      const saved = await saveImageAsJpg(req.file.buffer, 'plan');
      backgroundImage = saved.url;
      width = saved.width;
      height = saved.height;
    } catch {
      return res.status(400).json({ error: 'Image invalide (attendu: JPG/PNG/WebP...)' });
    }
  }

  const plan = {
    id: randomId('plan'),
    name: name.trim(),
    backgroundImage,
    width,
    height,
    zones: []
  };

  plans.push(plan);
  await writeJson(plansFile, plans);
  res.status(201).json(plan);
});

app.put('/api/plans/:id', authRequired, adminOnly, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const plans = await readJson(plansFile);
  const plan = plans.find((item) => item.id === id);
  if (!plan) return res.status(404).json({ error: 'Plan introuvable' });

  if (typeof req.body.name === 'string' && req.body.name.trim()) plan.name = req.body.name.trim();

  if (req.file?.buffer) {
    try {
      const saved = await saveImageAsJpg(req.file.buffer, 'plan');
      plan.backgroundImage = saved.url;
      plan.width = saved.width;
      plan.height = saved.height;
    } catch {
      return res.status(400).json({ error: 'Image invalide (attendu: JPG/PNG/WebP...)' });
    }
  }

  await writeJson(plansFile, plans);
  res.json(plan);
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

app.get('/api/cameras', authRequired, async (req, res) => {
  const cameras = await readJson(camerasFile);
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const withPlayback = cameras.map((camera) => {
    const playback = detectCameraPlayback(camera);
    if ((camera.streamUrl || '').toLowerCase().startsWith('rtsp://')) {
      playback.wsUrl = `/rtsp/${camera.id}?token=${encodeURIComponent(token)}`;
      const relay = getCameraRelay(camera.id);
      playback.relayStatus = relay.status;
      playback.relayError = relay.lastError;
      playback.webLiveUrl = `/live/${camera.id}/index.m3u8`;
    }
    return { ...camera, playback };
  });
  res.json(withPlayback);
});

app.post('/api/cameras', authRequired, adminOnly, async (req, res) => {
  const { name, zone = '', streamUrl = '', hlsUrl = '', status = 'offline', onvif = {} } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name requis' });

  const cameras = await readJson(camerasFile);
  const camera = { id: randomId('cam'), name, zone, status, streamUrl: normalizeRtspUrl(streamUrl), hlsUrl, onvif };
  cameras.push(camera);
  await writeJson(camerasFile, cameras);
  await syncRtspWebConverters();
  res.status(201).json(camera);
});

app.put('/api/cameras/:id', authRequired, adminOnly, async (req, res) => {
  const { id } = req.params;
  const cameras = await readJson(camerasFile);
  const camera = cameras.find((item) => item.id === id);
  if (!camera) return res.status(404).json({ error: 'Caméra introuvable' });

  const { name, zone, streamUrl, hlsUrl, status, onvif } = req.body;
  if (typeof name === 'string') camera.name = name;
  if (typeof zone === 'string') camera.zone = zone;
  if (typeof streamUrl === 'string') camera.streamUrl = normalizeRtspUrl(streamUrl);
  if (typeof hlsUrl === 'string') camera.hlsUrl = hlsUrl;
  if (typeof status === 'string') camera.status = status;
  if (onvif && typeof onvif === 'object') camera.onvif = { ...(camera.onvif || {}), ...onvif };

  await writeJson(camerasFile, cameras);
  await syncRtspWebConverters();
  res.json(camera);
});

app.get('/api/cameras/:id/playback', authRequired, async (req, res) => {
  const cameras = await readJson(camerasFile);
  const camera = cameras.find((item) => item.id === req.params.id);
  if (!camera) return res.status(404).json({ error: 'Caméra introuvable' });
  const playback = detectCameraPlayback(camera);
  if ((camera.streamUrl || '').toLowerCase().startsWith('rtsp://')) {
    await startRtspWebConverter(camera.id, camera.streamUrl);
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    playback.wsUrl = `/rtsp/${camera.id}?token=${encodeURIComponent(token)}`;
    const relay = getCameraRelay(camera.id);
    playback.relayStatus = relay.status;
    playback.relayError = relay.lastError;
    const webRelay = getRtspWeb(camera.id);
    playback.webLiveUrl = `/live/${camera.id}/index.m3u8`;
    playback.webRelayStatus = webRelay.status;
    playback.webRelayError = webRelay.lastError;
  }
  res.json(playback);
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
  await ensureUploadsDir();
  await ensureLiveDir();
  await setupMqttClientIfNeeded();
  await syncRtspWebConverters();
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


const rtspWss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  if (!url.pathname.startsWith('/rtsp/')) return;

  const token = url.searchParams.get('token');
  const payload = verifyToken(token);
  if (!payload) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  rtspWss.handleUpgrade(request, socket, head, (ws) => {
    rtspWss.emit('connection', ws, request, payload);
  });
});

rtspWss.on('connection', async (ws, request) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const cameraId = url.pathname.split('/').pop();
  const cameras = await readJson(camerasFile);
  const camera = cameras.find((item) => item.id === cameraId);

  if (!camera || !camera.streamUrl || !camera.streamUrl.toLowerCase().startsWith('rtsp://')) {
    ws.close(1008, 'RTSP stream introuvable');
    return;
  }

  const relay = await startRtspRelay(cameraId, camera.streamUrl);
  relay.clients.add(ws);

  ws.on('close', () => {
    relay.clients.delete(ws);
    stopRtspRelayIfUnused(cameraId);
  });
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

setInterval(() => {
  syncRtspWebConverters().catch(() => {});
}, 15000);
