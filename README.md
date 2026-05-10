# Sonos Volume Sync

A Node.js/TypeScript service designed to keep the volume levels of grouped Sonos speakers in perfect synchronization.

## Features

- **Automatic Discovery:** Uses SSDP (multicast) to find speakers or direct IP connection.
- **Group Awareness:** Dynamically detects logical groups. When a speaker's volume is changed, the service identifies its group and updates all other members.
- **Loop Prevention:** Implements a caching mechanism to ignore volume change events triggered by the service itself.
- **Real-time Updates:** Subscribes to UPnP events from speakers for near-instantaneous synchronization.
- **Docker Ready:** Optimized for both Linux (host networking) and Windows/macOS (bridge networking).

## Prerequisites

- **Docker & Docker Compose**
- **Linux Host (Recommended):** Best for "zero-config" deployment via host networking.
- **Windows/macOS:** Fully supported via optional configuration overrides.

## Configuration

Customizable via environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LOG_LEVEL` | Logging verbosity (`DEBUG`, `INFO`, `ERROR`) | `INFO` |
| `CACHE_TTL_MS` | Cooldown period for ignoring volume echos (ms) | `10000` |
| `SONOS_SEED_IP` | (Optional) IP of one Sonos speaker to bypass SSDP discovery | - |
| `SONOS_LISTENER_HOST`* | (Optional) Your host's IP for receiving UPnP events | - |
| `SONOS_LISTENER_PORT`* | (Optional) Port for receiving UPnP events | `6329` |

\* *Handled directly by the upstream `@svrooij/sonos` library.*


## Deployment

### **Synology (Container Manager)**

1. Open **Container Manager** and go to **Registry**.
2. Search for `sonosync` and download the image (`sjefen6/sonosync`).
3. Go to the **Container** tab and click **Create**.
4. Select the `sonosync:latest` image.
5. Enter a name and enable **"Enable auto-restart"**.
6. **Crucial:** Under **Network**, select **"host"**.
7. Click **Done**.

### **Linux (Server/Desktop)**

On Linux, the service works out-of-the-box using host networking. Use this `docker-compose.yml`:

```yaml
services:
  sonosync:
    image: sjefen6/sonosync:latest
    container_name: sonosync
    network_mode: "host"
    restart: unless-stopped
```

### **Windows / macOS (Docker Desktop)**

Discovery (multicast) typically fails on non-Linux Docker hosts. Use this configuration in your `docker-compose.yml`:

```yaml
services:
  sonosync:
    image: sjefen6/sonosync:latest
    container_name: sonosync
    ports:
      - "6329:6329"
    environment:
      - SONOS_SEED_IP=192.168.1.50      # IP of any one Sonos speaker
      - SONOS_LISTENER_HOST=192.168.1.10 # IP of your computer
    restart: unless-stopped
```

## Development

The project uses:
- **Language:** TypeScript
- **Library:** [@svrooij/sonos](https://github.com/svrooij/node-sonos-ts) for typed UPnP interactions.
- **Package Manager:** `pnpm`

### Local Setup (Optional)

If you wish to run locally without Docker:
```bash
pnpm install
pnpm exec tsc
node dist/index.js
```

## How It Works

1. **Discovery:** Uses SSDP (multicast) by default. If `SONOS_SEED_IP` is provided, it connects directly to that speaker and fetches the network topology via unicast.
2. **Subscription:** For every discovered device, the service subscribes to `RenderingControl` events (Volume).
3. **Sync Logic:** When a `Volume` event is received:
   - **Echo Cancellation:** It ignores events that are just "echos" of its own recent commands. This keeps things efficient and prevents redundant update loops.
   - **Group Resolution:** It identifies which speakers are currently grouped together.
   - **Parallel Broadcast:** It simultaneously updates the rest of the group to match.

