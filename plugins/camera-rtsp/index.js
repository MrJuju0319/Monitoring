const defaultConfig = require('./config.example.json');

function mergeConversion(defaultConversion = {}, streamConversion = {}) {
  return {
    ...defaultConversion,
    ...streamConversion,
  };
}

function buildCameraState(stream, defaults) {
  const conversion = mergeConversion(defaults.conversion, stream.conversion);
  const nowIso = new Date().toISOString();

  return {
    id: stream.id,
    name: stream.name,
    rtspUrl: stream.rtspUrl,
    transport: stream.transport || defaults.transport,
    conversion: {
      strategy: conversion.strategy || 'hls',
      publicUrl: conversion.publicUrl || null,
      codec: conversion.codec || 'unknown',
      mseCodec: conversion.mseCodec || defaults.conversion?.mseCodec || null,
      signalingUrl: conversion.signalingUrl || defaults.conversion?.webrtcSignalingUrl || null,
      hlsSegmentSeconds: conversion.hlsSegmentSeconds || defaults.conversion?.hlsSegmentSeconds || null,
    },
    widget: {
      x: stream.widget?.x ?? 50,
      y: stream.widget?.y ?? 50,
      width: stream.widget?.width ?? 24,
      height: stream.widget?.height ?? 20,
      zIndex: stream.widget?.zIndex ?? 1,
    },
    timeouts: {
      offlineAfterMs: stream.timeouts?.offlineAfterMs ?? defaults.offlineAfterMs ?? 45000,
      reconnectDelayMs: stream.timeouts?.reconnectDelayMs ?? defaults.reconnectDelayMs ?? 5000,
      healthCheckIntervalMs: stream.timeouts?.healthCheckIntervalMs ?? defaults.healthCheckIntervalMs ?? 15000,
      startupDelayMs: stream.timeouts?.startupDelayMs ?? defaults.startupDelayMs ?? 1000,
    },
    streamState: {
      status: 'starting',
      visualState: 'warning',
      errorCode: null,
      errorMessage: null,
      reconnectAttempt: 0,
      lastSeenAt: nowIso,
      updatedAt: nowIso,
    },
  };
}

class CameraRtspPlugin {
  constructor({ logger = console, realtimeBus, config = defaultConfig } = {}) {
    this.logger = logger;
    this.realtimeBus = realtimeBus;
    this.config = config;
    this.cameras = new Map();
    this.intervals = [];
    this.startupTimers = [];

    const defaults = this.config.defaults || {};
    for (const stream of this.config.streams || []) {
      this.cameras.set(stream.id, buildCameraState(stream, defaults));
    }
  }

  getCameras() {
    return [...this.cameras.values()];
  }

  start() {
    for (const camera of this.cameras.values()) {
      const startupDelayMs = camera.timeouts.startupDelayMs;
      const startupTimer = setTimeout(() => {
        this.markOnline(camera.id);
      }, startupDelayMs);
      this.startupTimers.push(startupTimer);

      const interval = setInterval(() => {
        this.runHealthCheck(camera.id);
      }, camera.timeouts.healthCheckIntervalMs);

      this.intervals.push(interval);
    }

    this.logger.info(`[camera-rtsp] ${this.cameras.size} flux RTSP initialisés.`);
  }

  runHealthCheck(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera) {
      return;
    }

    const now = Date.now();
    const lastSeenTs = Date.parse(camera.streamState.lastSeenAt || 0);
    const ageMs = Number.isNaN(lastSeenTs) ? Infinity : now - lastSeenTs;

    if (ageMs > camera.timeouts.offlineAfterMs) {
      this.markOffline(cameraId, {
        code: 'STREAM_TIMEOUT',
        message: `Aucun keepalive RTSP depuis ${ageMs}ms`,
      });
      return;
    }

    if (camera.streamState.status !== 'online') {
      this.markOnline(cameraId);
    }
  }

  markOnline(cameraId) {
    this.patchState(cameraId, {
      status: 'online',
      visualState: 'ok',
      errorCode: null,
      errorMessage: null,
      reconnectAttempt: 0,
      lastSeenAt: new Date().toISOString(),
    });
  }

  markOffline(cameraId, { code = 'STREAM_OFFLINE', message = 'Flux indisponible' } = {}) {
    const camera = this.cameras.get(cameraId);
    if (!camera) {
      return;
    }

    const nextAttempt = (camera.streamState.reconnectAttempt || 0) + 1;

    this.patchState(cameraId, {
      status: 'offline',
      visualState: 'error',
      errorCode: code,
      errorMessage: message,
      reconnectAttempt: nextAttempt,
    });

    setTimeout(() => {
      this.patchState(cameraId, {
        status: 'reconnecting',
        visualState: 'warning',
        errorCode: 'RECONNECTING',
        errorMessage: 'Tentative de reconnexion en cours',
      });

      const isRecovered = nextAttempt % 2 === 0;
      if (isRecovered) {
        this.markOnline(cameraId);
      }
    }, camera.timeouts.reconnectDelayMs);
  }

  reportHeartbeat(cameraId) {
    if (!this.cameras.has(cameraId)) {
      return false;
    }

    this.patchState(cameraId, {
      lastSeenAt: new Date().toISOString(),
      status: 'online',
      visualState: 'ok',
      errorCode: null,
      errorMessage: null,
      reconnectAttempt: 0,
    });

    return true;
  }

  reportError(cameraId, { code = 'STREAM_ERROR', message = 'Erreur de flux inconnue' } = {}) {
    if (!this.cameras.has(cameraId)) {
      return false;
    }

    this.markOffline(cameraId, { code, message });
    return true;
  }

  patchState(cameraId, patch) {
    const camera = this.cameras.get(cameraId);
    if (!camera) {
      return;
    }

    const updated = {
      ...camera,
      streamState: {
        ...camera.streamState,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    };

    this.cameras.set(cameraId, updated);
    this.realtimeBus.broadcast('camera_update', updated);
  }

  stop() {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    for (const timer of this.startupTimers) {
      clearTimeout(timer);
    }
    this.startupTimers = [];
  }
}

module.exports = {
  CameraRtspPlugin,
};
