import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VolumeSync } from './index';
import { SonosManager, SonosDevice } from '@svrooij/sonos';
import { EventEmitter } from 'events';

// Mock the @svrooij/sonos library
vi.mock('@svrooij/sonos', () => {
  class MockSonosManager {
    Devices = [];
    Groups = [];
    OnNewDevice = vi.fn();
    InitializeWithDiscovery = vi.fn();
    InitializeFromDevice = vi.fn();
    CancelSubscription = vi.fn();
  }

  return {
    SonosManager: MockSonosManager,
    SonosEvents: {
      Volume: 'Volume',
    },
  };
});

describe('VolumeSync', () => {
  let mockManager: any;
  let volumeSync: VolumeSync;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = new SonosManager();
    volumeSync = new VolumeSync(mockManager);
  });

  /**
   * Helper to create a mock Sonos device
   */
  function createMockDevice(uuid: string, name: string, groupName: string) {
    const events = new EventEmitter();
    return {
      Uuid: uuid,
      Name: name,
      GroupName: groupName,
      Events: events,
      SetVolume: vi.fn().mockResolvedValue(true),
    } as unknown as SonosDevice;
  }

  it('should broadcast volume change to all members in the same group', async () => {
    const dev1 = createMockDevice('uuid1', 'Speaker 1', 'Group A');
    const dev2 = createMockDevice('uuid2', 'Speaker 2', 'Group A');
    const dev3 = createMockDevice('uuid3', 'Speaker 3', 'Group A');
    
    mockManager.Devices = [dev1, dev2, dev3];

    await (volumeSync as any).handleVolumeChange(dev1, 25);

    expect(dev2.SetVolume).toHaveBeenCalledWith(25);
    expect(dev3.SetVolume).toHaveBeenCalledWith(25);
    expect(dev1.SetVolume).not.toHaveBeenCalled();
  });

  it('should ignore volume events that match the expected echo cache', async () => {
    const dev1 = createMockDevice('uuid1', 'Speaker 1', 'Group A');
    const dev2 = createMockDevice('uuid2', 'Speaker 2', 'Group A');
    mockManager.Devices = [dev1, dev2];

    await (volumeSync as any).handleVolumeChange(dev1, 30);
    expect(dev2.SetVolume).toHaveBeenCalledWith(30);

    vi.clearAllMocks();
    await (volumeSync as any).handleVolumeChange(dev2, 30);

    expect(dev1.SetVolume).not.toHaveBeenCalled();
  });

  it('should treat a volume event as manual if it arrives after TTL', async () => {
    vi.useFakeTimers();
    
    const dev1 = createMockDevice('uuid1', 'Speaker 1', 'Group A');
    const dev2 = createMockDevice('uuid2', 'Speaker 2', 'Group A');
    mockManager.Devices = [dev1, dev2];

    await (volumeSync as any).handleVolumeChange(dev1, 40);

    vi.advanceTimersByTime(11000);

    await (volumeSync as any).handleVolumeChange(dev2, 40);

    expect(dev1.SetVolume).toHaveBeenCalledWith(40);

    vi.useRealTimers();
  });

  it('should correctly filter group members even if multiple groups exist', async () => {
    const dev1 = createMockDevice('uuid1', 'Group A - 1', 'Group A');
    const dev2 = createMockDevice('uuid2', 'Group A - 2', 'Group A');
    const dev3 = createMockDevice('uuid3', 'Group B - 1', 'Group B');
    
    mockManager.Devices = [dev1, dev2, dev3];

    await (volumeSync as any).handleVolumeChange(dev1, 15);

    expect(dev2.SetVolume).toHaveBeenCalledWith(15);
    expect(dev3.SetVolume).not.toHaveBeenCalled();
  });
});
