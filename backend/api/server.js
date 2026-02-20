const path = require('node:path');
const express = require('express');
const { RealtimeBus } = require('./services/realtime-bus');
const { MqttMapPlugin } = require('../../plugins/mqtt-map');

const app = express();
const realtimeBus = new RealtimeBus();
const plugin = new MqttMapPlugin({ realtimeBus });

plugin.start();

app.use(express.static(path.resolve(__dirname, '../../frontend/plans')));

app.get('/api/points', (_req, res) => {
  res.json({
    points: plugin.getPoints(),
  });
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
  plugin.stop();
  process.exit(0);
});
