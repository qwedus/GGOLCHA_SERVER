# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monolith v2 is a DIY wireless data logging platform for Student Formula / Baja racing. It consists of ESP32-S3 firmware (C), a Vue 3 web control hub, and a Docker Compose server stack (MQTT broker, MQTT logger, InfluxDB). Two hardware variants exist: Original (full sensor suite) and Mini (compact, CAN + GPS + IMU + internal temp/voltage, no digital I/O), controlled by the `CONFIG_MONOLITH_MINI` compile flag.

## Build & Development Commands

### Web Frontend (`web/`)
```bash
npm run dev          # dev server (HTTPS, port 5173)
npm run build        # production build
npm run lint         # ESLint with auto-fix
```

### Firmware (`device/firmware/`)
Requires ESP-IDF v5.5.1 installed at `~/esp/esp-idf`.
```bash
make build           # compile firmware (Original)
make build mini      # compile firmware (Mini variant)
make run             # build, flash (921600 baud), and monitor
make config          # open ESP-IDF menuconfig
make clean           # remove build directory
```

### Server (`server/`)
Docker Compose stack. Requires `.env` file (see `.env.example`).

## Key Patterns

- The web app and firmware share the same binary log protocol — `protocol.js` constants must stay in sync with `main.h` definitions
- MQTT telemetry uses batching: CAN (up to 128 records) and syslog (up to 32 records) per single MQTT publish; web frontend parses in 24-byte (`log_t`) chunks
- Core affinity: WiFi/LWIP pinned to Core 0, MQTT publisher pinned to Core 1, ESP-MQTT internal task on Core 0, sensor tasks NO_AFFINITY

## CI/CD

- **firmware.yml** — Builds both Original and Mini on pushes to `device/firmware/**`
- **deploy.yml** — On pushes to `server/**` or `web/**`, SSHes into the EC2 host, rebuilds the web app and restarts the Docker Compose stack

## Commit Messages

Use lowercase prefixed format: `fix:`, `add:`, `update:`, `bump:`, `impl:` (e.g., `fix: CAN decoder idx mismatch with chart series order`).
