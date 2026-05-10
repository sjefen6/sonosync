import { SonosManager, SonosDevice, SonosEvents } from '@svrooij/sonos';

class VolumeSync {
  private manager: SonosManager;
  private expectedVolumes: Record<string, number> = {};

  constructor() {
    this.manager = new SonosManager();
  }

  async start() {
    console.log('Starting Sonos Volume Sync with verbose logging...');

    this.manager.OnNewDevice((device: SonosDevice) => {
      console.log(`[DISCOVERY] New device found: ${device.Name} (${device.Uuid})`);
      this.setupDeviceListeners(device);
    });

    try {
      await this.manager.InitializeWithDiscovery();
      console.log(`[INIT] Discovery finished. Found ${this.manager.Devices.length} devices.`);
      
      for (const device of this.manager.Devices) {
        this.setupDeviceListeners(device);
      }

      // Periodically log groups to verify topology awareness
      setInterval(() => {
        console.log(`[HEARTBEAT] Current Groups:`);
        const groupNames = Array.from(new Set(this.manager.Devices.map(d => d.GroupName).filter(Boolean)));
        groupNames.forEach(name => {
           const members = this.manager.Devices.filter(d => d.GroupName === name).map(m => m.Name);
           console.log(` - ${name}: ${members.join(', ')}`);
        });
      }, 30000);

    } catch (error) {
      console.error('[FATAL] Error during initialization:', error);
    }
  }

  private setupDeviceListeners(device: SonosDevice) {
    if (device.Events.listenerCount(SonosEvents.Volume) > 0) return;

    console.log(`[LISTEN] Setting up volume listener for ${device.Name} (${device.Uuid})`);

    device.Events.on(SonosEvents.Volume, (volume: number) => {
      this.handleVolumeChange(device, volume);
    });
  }

  private async handleVolumeChange(sourceDevice: SonosDevice, newVolume: number) {
    const uuid = sourceDevice.Uuid;

    // Log EVERY volume event for debugging
    console.log(`[EVENT] Volume ${newVolume} received from ${sourceDevice.Name} (${uuid})`);

    if (this.expectedVolumes[uuid] === newVolume) {
      console.log(`[ECHO] Ignoring expected volume ${newVolume} for ${sourceDevice.Name}`);
      delete this.expectedVolumes[uuid];
      return;
    }

    const groupName = sourceDevice.GroupName;
    if (!groupName) {
      console.log(`[WARN] Device ${sourceDevice.Name} has no GroupName, skipping sync.`);
      return;
    }

    const groupMembers = this.manager.Devices.filter(d => d.GroupName === groupName);
    
    if (groupMembers.length <= 1) {
      console.log(`[INFO] ${sourceDevice.Name} is alone in group "${groupName}", nothing to sync.`);
      return;
    }

    console.log(`[SYNC] Syncing ${newVolume} to group "${groupName}" (Members: ${groupMembers.map(m => m.Name).join(', ')})`);

    for (const member of groupMembers) {
      if (member.Uuid === uuid) continue;

      try {
        console.log(`[CMD] Setting ${member.Name} volume to ${newVolume}...`);
        this.expectedVolumes[member.Uuid] = newVolume;
        
        // Use a timeout to ensure SetVolume doesn't hang indefinitely
        const result = await Promise.race([
            member.SetVolume(newVolume),
            new Promise((_, reject) => setTimeout(() => reject(new Error('SetVolume Timeout')), 5000))
        ]);
        
        console.log(`[OK] ${member.Name} set to ${newVolume}`);
      } catch (error) {
        console.error(`[ERROR] Failed to set volume for ${member.Name}:`, (error as Error).message);
        delete this.expectedVolumes[member.Uuid];
      }
    }
  }
}

const sync = new VolumeSync();
sync.start().catch(console.error);
