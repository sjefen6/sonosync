# Sonos Volume Sync

A Node.js/TypeScript service designed to keep the volume levels of grouped Sonos speakers in perfect synchronization.

## Features

- **Automatic Discovery:** Uses SSDP to find all Sonos speakers on your local network.
- **Group Awareness:** Dynamically detects logical groups. When a speaker's volume is changed, the service identifies its group and updates all other members.
- **Loop Prevention:** Implements a caching mechanism to ignore volume change events triggered by the service itself, preventing infinite feedback loops.
- **Real-time Updates:** Subscribes to UPnP events from speakers for near-instantaneous synchronization.
- **Docker Ready:** Optimized for containerized deployment (requires host networking for discovery).

## Prerequisites

- **Docker & Docker Compose:** For running the application without local Node.js installation.
- **Linux Host:** Recommended for deployment due to Docker networking limitations on Windows/macOS (host networking is required for SSDP discovery).

## Configuration

The service works out-of-the-box with sensible defaults, but can be customized via environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LOG_LEVEL` | Logging verbosity (`DEBUG`, `INFO`, `ERROR`) | `INFO` |
| `CACHE_TTL_MS` | Cooldown period for ignoring volume echos (ms) | `10000` |

## Deployment

### **Synology (Container Manager)**

1. Open **Container Manager** and go to **Registry**.
2. Search for `sonosync` and download the image (`sjefen6/sonosync`).
3. Go to the **Container** tab and click **Create**.
4. Select the `sonosync:latest` image.
5. Enter a name and enable **"Enable auto-restart"**.
6. **Crucial:** Under **Network**, select **"host"**.
7. Click **Done**.

### **Docker CLI**

```bash
docker run -d \
  --name sonosync \
  --network host \
  --restart unless-stopped \
  sjefen6/sonosync:latest
```

### **Docker Compose**

```yaml
services:
  sonosync:
    image: sjefen6/sonosync:latest
    container_name: sonosync
    network_mode: "host"
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

1. **Discovery:** The `SonosManager` searches for a speaker and then fetches the entire network topology.
2. **Subscription:** For every discovered device, the service subscribes to `RenderingControl` events (Volume).
3. **Sync Logic:** When a `Volume` event is received:
   - It checks if the new volume matches a recently commanded "expected" volume (to skip its own updates).
   - It finds the current members of the speaker's group.
   - It iterates through members and calls `SetVolume` to match the source speaker.
