const path = require('node:path');
const express = require('express');
const { RealtimeBus } = require('./services/realtime-bus');
const { MqttMapPlugin } = require('../../plugins/mqtt-map');
const { CameraRtspPlugin } = require('../../plugins/camera-rtsp');

const app = express();
app.use(express.json());

const realtimeBus = new RealtimeBus();
const mqttMapPlugin = new MqttMapPlugin({ realtimeBus });
const cameraRtspPlugin = new CameraRtspPlugin({ realtimeBus });

mqttMapPlugin.start();
cameraRtspPlugin.start();

app.use(express.static(path.resolve(__dirname, '../../frontend/plans')));

app.get('/api/points', (_req, res) => {
  res.json({
    points: mqttMapPlugin.getPoints(),
  });
});

app.get('/api/cameras', (_req, res) => {
  res.json({
    cameras: cameraRtspPlugin.getCameras(),
  });
});

app.post('/api/cameras/:cameraId/heartbeat', (req, res) => {
  const ok = cameraRtspPlugin.reportHeartbeat(req.params.cameraId);
  if (!ok) {
    return res.status(404).json({ error: 'camera_not_found' });
  }

  return res.json({ status: 'ok' });
});

app.post('/api/cameras/:cameraId/error', (req, res) => {
  const ok = cameraRtspPlugin.reportError(req.params.cameraId, {
    code: req.body?.code,
    message: req.body?.message,
  });

  if (!ok) {
    return res.status(404).json({ error: 'camera_not_found' });
  }

  return res.json({ status: 'ok' });
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  realtimeBus.addClient(res);
  res.write('event: ready\ndata: {"status":"connected"}\n\n');

  req.on('close', () => {
    realtimeBus.removeClient(res);
    res.end();
  });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, '0.0.0.0', () => {
  console.log(`[monitoring] Backend démarré sur http://0.0.0.0:${port}`);
});

process.on('SIGINT', () => {
  mqttMapPlugin.stop();
  cameraRtspPlugin.stop();
  process.exit(0);
});
