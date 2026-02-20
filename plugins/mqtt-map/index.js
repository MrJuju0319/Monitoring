const fs = require('node:fs');
const path = require('node:path');
const mqtt = require('mqtt');

const defaultConfig = require('./config.example.json');

function readFileIfExists(filePath) {
  if (!filePath) {
    return undefined;
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    return undefined;
  }

  return fs.readFileSync(resolvedPath);
}

function extractByPath(payload, dotPath) {
  if (!dotPath) {
    return payload;
  }

  return dotPath.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) {
      return undefined;
    }

    return acc[key];
  }, payload);
}

class MqttMapPlugin {
  constructor({ logger = console, realtimeBus, config = defaultConfig } = {}) {
    this.logger = logger;
    this.realtimeBus = realtimeBus;
    this.config = config;
    this.client = null;
    this.points = new Map();
    this.lastErrorLogAt = 0;

    for (const point of this.config.points) {
      this.points.set(point.id, {
        ...point,
        sourceTopic: point.sourceTopic,
        status: 'unknown',
        lastPayload: null,
        lastUpdate: null,
      });
    }
  }

  getPoints() {
    return [...this.points.values()];
  }

  start() {
    const options = {
      clientId: process.env.MQTT_MAP_CLIENT_ID || this.config.broker.clientId,
      username: process.env.MQTT_MAP_USERNAME || this.config.broker.username,
      password: process.env.MQTT_MAP_PASSWORD || this.config.broker.password,
      rejectUnauthorized: process.env.MQTT_MAP_REJECT_UNAUTHORIZED !== 'false',
      reconnectPeriod: Number(process.env.MQTT_MAP_RECONNECT_PERIOD || 5000),
      ca: readFileIfExists(process.env.MQTT_MAP_CA_FILE || this.config.broker.tls?.caFile),
      cert: readFileIfExists(process.env.MQTT_MAP_CERT_FILE || this.config.broker.tls?.certFile),
      key: readFileIfExists(process.env.MQTT_MAP_KEY_FILE || this.config.broker.tls?.keyFile),
    };

    this.client = mqtt.connect(process.env.MQTT_MAP_BROKER_URL || this.config.broker.url, options);

    this.client.on('connect', () => {
      this.logger.info('[mqtt-map] Connecté au broker MQTT.');
      for (const subscription of this.config.subscriptions) {
        this.client.subscribe(subscription.topic, { qos: subscription.qos ?? 0 }, (err) => {
          if (err) {
            this.logger.error(`[mqtt-map] Erreur abonnement ${subscription.topic}:`, err.message);
            return;
          }

          this.logger.info(`[mqtt-map] Abonné à ${subscription.topic}`);
        });
      }
    });

    this.client.on('message', (topic, messageBuffer) => {
      let parsedPayload;
      const messageText = messageBuffer.toString('utf8');

      try {
        parsedPayload = JSON.parse(messageText);
      } catch {
        parsedPayload = { raw: messageText };
      }

      this.applyMappings(topic, parsedPayload);
    });

    this.client.on('error', (error) => {
      const now = Date.now();
      if (now - this.lastErrorLogAt > 10000) {
        const detail = error?.message || error?.code || 'erreur inconnue';
        this.logger.error('[mqtt-map] Erreur MQTT:', detail);
        this.lastErrorLogAt = now;
      }
    });
  }

  applyMappings(topic, payload) {
    const mappings = this.config.mappings.filter((mapping) => mapping.topic === topic);

    for (const mapping of mappings) {
      const point = this.points.get(mapping.pointId);
      if (!point) {
        continue;
      }

      const value = extractByPath(payload, mapping.statusField);
      const style = mapping.states[String(value)] || mapping.defaultState;

      const updated = {
        ...point,
        status: String(value),
        color: style.color,
        icon: style.icon,
        label: style.labelPrefix ? `${style.labelPrefix} ${point.label}` : point.label,
        lastPayload: payload,
        lastUpdate: new Date().toISOString(),
      };

      this.points.set(point.id, updated);
      this.realtimeBus.broadcast('point_update', updated);
    }
  }

  stop() {
    if (this.client) {
      this.client.end(true);
    }
  }
}

module.exports = {
  MqttMapPlugin,
};
