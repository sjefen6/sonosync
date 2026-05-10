import { SonosManager, SonosDevice, SonosEvents } from '@svrooij/sonos';

/**
 * Interface for tracking expected volume changes to prevent feedback loops.
 */
interface ExpectedVolume {
  volume: number;
  timestamp: number;
}

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  ERROR = 2
}

/**
 * Service to synchronize volume across grouped Sonos speakers.
 */
class VolumeSync {
  private manager: SonosManager;
  /** Map of UUID to expected volume info with TTL support to prevent echo loops */
  private expectedVolumes = new Map<string, ExpectedVolume>();
  /** Set of UUIDs already being listened to */
  private initializedDevices = new Set<string>();
  
  private readonly cacheTtlMs: number;
  private currentLogLevel: LogLevel = LogLevel.INFO;

  constructor() {
    this.manager = new SonosManager();
    this.setupLogLevel();
    this.cacheTtlMs = parseInt(process.env.CACHE_TTL_MS || '10000', 10);
  }

  private setupLogLevel() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel === 'DEBUG') this.currentLogLevel = LogLevel.DEBUG;
    else if (envLevel === 'ERROR') this.currentLogLevel = LogLevel.ERROR;
    else this.currentLogLevel = LogLevel.INFO;
  }

  /**
   * Starts the discovery process and sets up signal handlers.
   */
  async start() {
    this.log('info', 'Starting Sonos Volume Sync Service...');
    this.setupSignalHandlers();

    this.manager.OnNewDevice((device: SonosDevice) => {
      this.setupDeviceListeners(device);
    });

    await this.initializeDiscovery();
  }

  /**
   * Discovery with retry logic.
   */
  private async initializeDiscovery() {
    let success = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!success && attempts < maxAttempts) {
      try {
        attempts++;
        this.log('info', `Discovery attempt ${attempts}/${maxAttempts}...`);
        await this.manager.InitializeWithDiscovery();
        
        this.log('info', `Discovery finished. Found ${this.manager.Devices.length} devices.`);
        
        for (const device of this.manager.Devices) {
          this.setupDeviceListeners(device);
        }
        success = true;
      } catch (error) {
        this.log('error', `Discovery failed on attempt ${attempts}`, error);
        if (attempts < maxAttempts) {
          this.log('info', 'Retrying in 10 seconds...');
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }
    }

    if (!success) {
      this.log('error', 'Could not discover any Sonos devices after multiple attempts. Exiting.');
      process.exit(1);
    }
  }

  /**
   * Sets up listeners for a device. Handles re-subscription if device re-appears.
   */
  private setupDeviceListeners(device: SonosDevice) {
    // If we already have a listener, check if the object is different (re-discovery)
    // The library usually emits a new object on re-discovery if the old one timed out.
    if (this.initializedDevices.has(device.Uuid)) {
        this.log('debug', `Device ${device.Name} already tracked. Refreshing subscription state.`);
    } else {
        this.log('info', `New device found: ${device.Name} (${device.Uuid})`);
        this.initializedDevices.add(device.Uuid);
    }

    // Always clear old listeners on the object just in case
    device.Events.removeAllListeners(SonosEvents.Volume);

    device.Events.on(SonosEvents.Volume, (volume: number) => {
      this.handleVolumeChange(device, volume).catch(err => 
        this.log('error', `Handler failed for ${device.Name}`, err)
      );
    });
  }

  /**
   * Core logic for synchronizing volume.
   */
  private async handleVolumeChange(sourceDevice: SonosDevice, newVolume: number) {
    const uuid = sourceDevice.Uuid;
    const now = Date.now();
    
    this.log('debug', `Handler triggered for ${sourceDevice.Name} volume: ${newVolume}`);

    const expected = this.expectedVolumes.get(uuid);
    if (expected) {
      const isWithinTTL = (now - expected.timestamp) < this.cacheTtlMs;
      const volumeMatches = Number(expected.volume) === Number(newVolume);
      
      if (isWithinTTL && volumeMatches) {
        this.log('info', `[ECHO] Ignored sync echo from ${sourceDevice.Name} (${newVolume}%)`);
        this.expectedVolumes.delete(uuid);
        return;
      }
      
      if (!isWithinTTL) {
        this.expectedVolumes.delete(uuid);
      }
    }

    const groupName = sourceDevice.GroupName;
    if (!groupName) return;

    const groupMembers = this.manager.Devices.filter(d => 
      d.GroupName === groupName && d.Uuid !== uuid
    );
    
    if (groupMembers.length === 0) return;

    this.log('info', `[EVENT] ${sourceDevice.Name} manual change -> ${newVolume}%`);
    this.log('info', `[SYNC] Broadcasting ${newVolume}% to group "${groupName}" (${groupMembers.length} members)`);

    const syncTasks = groupMembers.map(async (member) => {
      try {
        this.expectedVolumes.set(member.Uuid, { volume: newVolume, timestamp: Date.now() });
        await member.SetVolume(newVolume);
        this.log('debug', `Successfully updated ${member.Name}`);
      } catch (error) {
        this.log('error', `Failed to sync ${member.Name}`, error);
        this.expectedVolumes.delete(member.Uuid);
      }
    });

    await Promise.allSettled(syncTasks);
  }

  /**
   * Graceful shutdown logic.
   */
  private setupSignalHandlers() {
    const shutdown = async (signal: string) => {
      this.log('info', `Received ${signal}. Shutting down gracefully...`);
      try {
        this.manager.CancelSubscription();
        this.log('info', 'Unsubscribed from all events. Bye!');
        process.exit(0);
      } catch (err) {
        this.log('error', 'Error during shutdown', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  private log(level: 'info' | 'error' | 'debug', message: string, data?: any) {
    const numericLevel = level === 'debug' ? LogLevel.DEBUG : (level === 'error' ? LogLevel.ERROR : LogLevel.INFO);
    if (numericLevel < this.currentLogLevel) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    if (level === 'error') {
      console.error(`${prefix} ${message}`, data ?? '');
    } else {
      console.log(`${prefix} ${message}`);
    }
  }
}

const sync = new VolumeSync();
sync.start().catch(err => {
    console.error('FATAL STARTUP ERROR:', err);
    process.exit(1);
});
