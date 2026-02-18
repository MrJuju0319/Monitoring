#!/usr/bin/env python3
"""Passerelle locale:
- RTSP -> HLS pour affichage navigateur
- Relai MQTT (mqtt:// ou ws://) pour clients web
"""

from __future__ import annotations

import re
import shutil
import signal
import subprocess
import threading
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_from_directory

try:
    from paho.mqtt import client as mqtt
except Exception:  # pragma: no cover
    mqtt = None

BASE_DIR = Path(__file__).parent.resolve()
HLS_DIR = BASE_DIR / "hls"
HLS_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
VIDEO_PROCESSES: Dict[str, subprocess.Popen] = {}
MQTT_CLIENTS: Dict[str, mqtt.Client] = {}
MQTT_INFO: Dict[str, Dict[str, str]] = {}
MQTT_TOPICS: Dict[str, str] = {}
MQTT_LOCK = threading.Lock()


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    return response


def sanitize_id(raw: str, label: str = "id") -> str:
    raw = (raw or "").strip().lower()
    if not raw:
        raise ValueError(f"{label} manquant")
    return re.sub(r"[^a-z0-9_-]+", "-", raw)


def stop_camera(camera_id: str) -> None:
    proc = VIDEO_PROCESSES.pop(camera_id, None)
    if not proc:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


def stop_mqtt(server_id: str) -> None:
    client = MQTT_CLIENTS.pop(server_id, None)
    MQTT_INFO.pop(server_id, None)
    if not client:
        return
    try:
        client.loop_stop()
        client.disconnect()
    except Exception:
        pass


@app.post("/api/cameras")
def create_camera():
    payload = request.get_json(silent=True) or {}
    camera_id = sanitize_id(str(payload.get("camera_id", "")), "camera_id")
    rtsp_url = str(payload.get("rtsp_url", "")).strip()
    if not rtsp_url:
        return jsonify({"ok": False, "error": "rtsp_url manquant"}), 400

    stop_camera(camera_id)

    out_dir = HLS_DIR / camera_id
    if out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    playlist = out_dir / "index.m3u8"
    segment = out_dir / "segment_%05d.ts"

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        rtsp_url,
        "-fflags",
        "+genpts",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-c:a",
        "aac",
        "-f",
        "hls",
        "-hls_time",
        "1",
        "-hls_list_size",
        "6",
        "-hls_flags",
        "delete_segments+append_list+independent_segments",
        "-hls_segment_filename",
        str(segment),
        str(playlist),
    ]

    try:
        proc = subprocess.Popen(cmd)
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "ffmpeg introuvable. Installe ffmpeg."}), 500

    VIDEO_PROCESSES[camera_id] = proc
    return jsonify({"ok": True, "camera_id": camera_id, "hls_url": f"http://127.0.0.1:8787/hls/{camera_id}/index.m3u8"})


@app.delete("/api/cameras/<camera_id>")
def delete_camera(camera_id: str):
    camera_id = sanitize_id(camera_id, "camera_id")
    stop_camera(camera_id)
    shutil.rmtree(HLS_DIR / camera_id, ignore_errors=True)
    return jsonify({"ok": True, "camera_id": camera_id})


@app.get("/hls/<camera_id>/<path:filename>")
def serve_hls(camera_id: str, filename: str):
    camera_id = sanitize_id(camera_id, "camera_id")
    return send_from_directory(HLS_DIR / camera_id, filename)


@app.post("/api/mqtt/servers")
def mqtt_connect():
    if mqtt is None:
        return jsonify({"ok": False, "error": "paho-mqtt manquant (pip install paho-mqtt)"}), 500

    payload = request.get_json(silent=True) or {}
    server_id = sanitize_id(str(payload.get("server_id", "")), "server_id")
    broker_url = str(payload.get("broker_url", "")).strip()
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", "")).strip()
    topic = str(payload.get("topic", "#") or "#").strip() or "#"

    if not broker_url:
        return jsonify({"ok": False, "error": "broker_url manquant"}), 400

    parsed = urlparse(broker_url)
    scheme = (parsed.scheme or "mqtt").lower()
    host = parsed.hostname
    port = parsed.port

    if not host:
        return jsonify({"ok": False, "error": "broker_url invalide"}), 400

    if scheme in ("mqtt", "tcp"):
        transport = "tcp"
        default_port = 1883
    elif scheme in ("mqtts", "ssl"):
        transport = "tcp"
        default_port = 8883
    elif scheme in ("ws", "wss"):
        transport = "websockets"
        default_port = 80 if scheme == "ws" else 443
    else:
        return jsonify({"ok": False, "error": f"scheme non supporté: {scheme}"}), 400

    port = port or default_port

    stop_mqtt(server_id)

    client = mqtt.Client(client_id=f"acre-gateway-{server_id}", transport=transport)
    if username:
        client.username_pw_set(username, password)
    if scheme in ("mqtts", "ssl", "wss"):
        client.tls_set()

    def _on_connect(_client, _userdata, _flags, rc, *_args):
        status = "connected" if rc == 0 else f"error:{rc}"
        with MQTT_LOCK:
            MQTT_INFO[server_id] = {"status": status, "broker_url": broker_url, "topic": topic}
        if rc == 0:
            _client.subscribe(topic)

    def _on_message(_client, _userdata, msg):
        try:
            payload_text = msg.payload.decode("utf-8", errors="replace")
        except Exception:
            payload_text = str(msg.payload)
        with MQTT_LOCK:
            MQTT_TOPICS[msg.topic] = payload_text

    def _on_disconnect(_client, _userdata, rc, *_args):
        with MQTT_LOCK:
            info = MQTT_INFO.get(server_id, {})
            info["status"] = f"disconnected:{rc}"
            MQTT_INFO[server_id] = info

    client.on_connect = _on_connect
    client.on_message = _on_message
    client.on_disconnect = _on_disconnect

    try:
        client.connect(host, port, keepalive=30)
        client.loop_start()
    except Exception as exc:
        return jsonify({"ok": False, "error": f"connexion impossible: {exc}"}), 500

    MQTT_CLIENTS[server_id] = client
    with MQTT_LOCK:
        MQTT_INFO[server_id] = {"status": "connecting", "broker_url": broker_url, "topic": topic}

    return jsonify({"ok": True, "server_id": server_id, "status": "connecting"})


@app.delete("/api/mqtt/servers/<server_id>")
def mqtt_disconnect(server_id: str):
    server_id = sanitize_id(server_id, "server_id")
    stop_mqtt(server_id)
    return jsonify({"ok": True, "server_id": server_id})


@app.get("/api/mqtt/topics")
def mqtt_topics():
    with MQTT_LOCK:
        return jsonify({"ok": True, "topics": MQTT_TOPICS})


@app.post("/api/mqtt/clear")
def mqtt_clear():
    with MQTT_LOCK:
        MQTT_TOPICS.clear()
    return jsonify({"ok": True})


@app.get("/api/mqtt/status")
def mqtt_status():
    with MQTT_LOCK:
        return jsonify({"ok": True, "servers": MQTT_INFO, "topic_count": len(MQTT_TOPICS)})


@app.get("/health")
def health():
    with MQTT_LOCK:
        mqtt_servers = dict(MQTT_INFO)
        mqtt_count = len(MQTT_TOPICS)
    return jsonify({"ok": True, "video_running": sorted(VIDEO_PROCESSES.keys()), "mqtt": mqtt_servers, "mqtt_topic_count": mqtt_count})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8787)
