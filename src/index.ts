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

class VolumeSync {
  private manager: SonosManager;
  /** Map of UUID to expected volume info with TTL support */
  private expectedVolumes = new Map<string, ExpectedVolume>();
  /** Set of UUIDs already being listened to */
  private initializedDevices = new Set<string>();
  
  private readonly CACHE_TTL_MS = 10000; // 10 seconds cooldown for echoes
  private currentLogLevel: LogLevel = LogLevel.INFO;

  constructor() {
    this.manager = new SonosManager();
    this.setupLogLevel();
  }

  private setupLogLevel() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel === 'DEBUG') this.currentLogLevel = LogLevel.DEBUG;
    else if (envLevel === 'ERROR') this.currentLogLevel = LogLevel.ERROR;
    else this.currentLogLevel = LogLevel.INFO;
  }

  async start() {
    this.log('info', 'Starting Sonos Volume Sync Service...');

    this.manager.OnNewDevice((device: SonosDevice) => {
      this.setupDeviceListeners(device);
    });

    try {
      await this.manager.InitializeWithDiscovery();
      this.log('info', `Discovery finished. Monitoring ${this.manager.Devices.length} devices.`);
      
      // Ensure all initially discovered devices are covered
      for (const device of this.manager.Devices) {
        this.setupDeviceListeners(device);
      }
    } catch (error) {
      this.log('error', 'Critical initialization error', error);
    }
  }

  private setupDeviceListeners(device: SonosDevice) {
    if (this.initializedDevices.has(device.Uuid)) return;

    this.log('debug', `Listening to ${device.Name} (${device.Uuid})`);
    this.initializedDevices.add(device.Uuid);

    device.Events.on(SonosEvents.Volume, (volume: number) => {
      this.handleVolumeChange(device, volume).catch(err => 
        this.log('error', `Handler failed for ${device.Name}`, err)
      );
    });
  }

  private async handleVolumeChange(sourceDevice: SonosDevice, newVolume: number) {
    const uuid = sourceDevice.Uuid;
    const now = Date.now();
    
    this.log('debug', `Handler triggered for ${sourceDevice.Name} volume: ${newVolume}`);

    // 1. Echo/Feedback loop check with TTL
    const expected = this.expectedVolumes.get(uuid);
    
    if (expected) {
      const isWithinTTL = (now - expected.timestamp) < this.CACHE_TTL_MS;
      const volumeMatches = Number(expected.volume) === Number(newVolume);
      
      if (isWithinTTL && volumeMatches) {
        this.log('info', `[ECHO] Ignored sync echo from ${sourceDevice.Name} (${newVolume}%)`);
        this.expectedVolumes.delete(uuid);
        return;
      }
      
      if (!isWithinTTL) {
        this.log('debug', `Expected volume for ${sourceDevice.Name} expired.`);
        this.expectedVolumes.delete(uuid);
      }
    }

    this.log('info', `[EVENT] ${sourceDevice.Name} manual change -> ${newVolume}%`);

    // 2. Resolve Group
    const groupName = sourceDevice.GroupName;
    if (!groupName) return;

    const groupMembers = this.manager.Devices.filter(d => 
      d.GroupName === groupName && d.Uuid !== uuid
    );
    
    if (groupMembers.length === 0) return;

    this.log('info', `[SYNC] Broadcasting ${newVolume}% to group "${groupName}" (${groupMembers.length} members)`);

    // 3. Parallel Broadcast
    const syncTasks = groupMembers.map(async (member) => {
      try {
        // Record expectation BEFORE calling to avoid race conditions with fast events
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
   * Structured logger helper
   */
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
sync.start().catch(err => console.error('FATAL:', err));
