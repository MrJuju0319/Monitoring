#!/usr/bin/env python3
"""Passerelle locale RTSP -> HLS pour affichage navigateur.

API:
- POST /api/cameras {camera_id, rtsp_url}
- DELETE /api/cameras/<camera_id>
- GET /hls/<camera_id>/index.m3u8
"""

from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
from pathlib import Path
from typing import Dict

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).parent.resolve()
HLS_DIR = BASE_DIR / "hls"
HLS_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
PROCESSES: Dict[str, subprocess.Popen] = {}


def sanitize_camera_id(raw: str) -> str:
    raw = (raw or "").strip().lower()
    if not raw:
        raise ValueError("camera_id manquant")
    return re.sub(r"[^a-z0-9_-]+", "-", raw)


def stop_camera(camera_id: str) -> None:
    proc = PROCESSES.pop(camera_id, None)
    if not proc:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


@app.post("/api/cameras")
def create_camera():
    payload = request.get_json(silent=True) or {}
    camera_id = sanitize_camera_id(str(payload.get("camera_id", "")))
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

    PROCESSES[camera_id] = proc
    return jsonify(
        {
            "ok": True,
            "camera_id": camera_id,
            "hls_url": f"http://127.0.0.1:8787/hls/{camera_id}/index.m3u8",
        }
    )


@app.delete("/api/cameras/<camera_id>")
def delete_camera(camera_id: str):
    camera_id = sanitize_camera_id(camera_id)
    stop_camera(camera_id)
    out_dir = HLS_DIR / camera_id
    shutil.rmtree(out_dir, ignore_errors=True)
    return jsonify({"ok": True, "camera_id": camera_id})


@app.get("/hls/<camera_id>/<path:filename>")
def serve_hls(camera_id: str, filename: str):
    camera_id = sanitize_camera_id(camera_id)
    return send_from_directory(HLS_DIR / camera_id, filename)


@app.get("/health")
def health():
    return jsonify({"ok": True, "running": sorted(PROCESSES.keys())})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8787)
