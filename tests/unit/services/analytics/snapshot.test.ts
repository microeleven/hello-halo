/**
 * Unit tests for Analytics Startup Snapshot
 *
 * Tests:
 *   - Snapshot emission (installed_apps.snapshot)
 *   - Watermark-based replay (app.run.replay)
 *   - Edge cases: no apps, uninitialized analytics, empty history
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runStartupSnapshot } from '../../../../src/main/services/analytics/snapshot'
import { analytics } from '../../../../src/main/services/analytics/analytics.service'
import type { AppManagerService, InstalledApp } from '../../../../src/main/apps/manager/types'
import type { AppRuntimeService, AutomationRun } from '../../../../src/main/apps/runtime/types'

// Mock the analytics service
vi.mock('../../../../src/main/services/analytics/analytics.service', () => ({
  analytics: {
    initialized: true,
    // whenSettled must resolve true so snapshot runs in tests; production
    // uses it to block on the bootstrap race.
    whenSettled: vi.fn().mockResolvedValue(true),
    track: vi.fn().mockResolvedValue(undefined),
    getSnapshotState: vi.fn().mockReturnValue({}),
    setSnapshotState: vi.fn(),
  },
}))

const mockTrack = analytics.track as ReturnType<typeof vi.fn>
const mockGetSnapshotState = analytics.getSnapshotState as ReturnType<typeof vi.fn>
const mockSetSnapshotState = analytics.setSnapshotState as ReturnType<typeof vi.fn>

// ── Test Fixtures ──────────────────────────────────────────────────────

function createApp(id: string, status: string = 'active'): InstalledApp {
  return {
    id,
    specId: `spec-${id}`,
    status,
    spec: { type: 'automation', version: '1.0.0', name: `App ${id}` } as any,
    installedAt: 1700000000000,
    spaceId: 'space-1',
  } as InstalledApp
}

function createRun(
  runId: string,
  appId: string,
  status: 'ok' | 'error' | 'skipped',
  finishedAt: number
): AutomationRun {
  return {
    runId,
    appId,
    status,
    triggerType: 'schedule',
    startedAt: finishedAt - 1000,
    finishedAt,
    durationMs: 1000,
  } as AutomationRun
}

// ── Mock Service Factories ─────────────────────────────────────────────

function makeAppManager(apps: InstalledApp[]): AppManagerService {
  return {
    listApps: vi.fn().mockReturnValue(apps),
  } as unknown as AppManagerService
}

function makeRuntime(runsMap: Record<string, AutomationRun[]>): AppRuntimeService {
  return {
    getRunsForApp: vi.fn((appId: string) => runsMap[appId] ?? []),
  } as unknown as AppRuntimeService
}

describe('runStartupSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: analytics initialized, no prior watermark
    ;(analytics as any).initialized = true
    mockGetSnapshotState.mockReturnValue({})
  })

  // ── Skip cases ──────────────────────────────────────────────────────

  it('should skip when analytics is not initialized', async () => {
    ;(analytics as any).initialized = false
    const mgr = makeAppManager([createApp('a1')])
    const rt = makeRuntime({})

    await runStartupSnapshot(mgr, rt)
    expect(mockTrack).not.toHaveBeenCalled()
  })

  // ── Installed apps snapshot ──────────────────────────────────────────

  it('should emit installed_apps.snapshot for active apps', async () => {
    const apps = [createApp('a1'), createApp('a2')]
    const mgr = makeAppManager(apps)
    const rt = makeRuntime({})

    await runStartupSnapshot(mgr, rt)

    expect(mockTrack).toHaveBeenCalledWith(
      'installed_apps.snapshot',
      expect.objectContaining({
        count: 2,
        apps: expect.arrayContaining([
          expect.objectContaining({ appId: 'a1', specId: 'spec-a1' }),
          expect.objectContaining({ appId: 'a2', specId: 'spec-a2' }),
        ]),
      })
    )
  })

  it('should exclude uninstalled apps from snapshot', async () => {
    const apps = [createApp('a1', 'active'), createApp('a2', 'uninstalled')]
    const mgr = makeAppManager(apps)
    const rt = makeRuntime({})

    await runStartupSnapshot(mgr, rt)

    const snapshotCall = mockTrack.mock.calls.find(
      ([name]) => name === 'installed_apps.snapshot'
    )
    expect(snapshotCall).toBeDefined()
    expect(snapshotCall![1].count).toBe(1)
    expect(snapshotCall![1].apps).toHaveLength(1)
    expect(snapshotCall![1].apps[0].appId).toBe('a1')
  })

  it('should emit snapshot with count=0 when no apps installed', async () => {
    const mgr = makeAppManager([])
    const rt = makeRuntime({})

    await runStartupSnapshot(mgr, rt)

    expect(mockTrack).toHaveBeenCalledWith(
      'installed_apps.snapshot',
      { apps: [], count: 0 }
    )
  })

  // ── Run replay ─────────────────────────────────────────────────────

  it('should replay runs newer than the watermark', async () => {
    mockGetSnapshotState.mockReturnValue({ lastSnapshotTs: 1000, lastSnapshotRunId: null })

    const apps = [createApp('a1')]
    const runs: AutomationRun[] = [
      createRun('r1', 'a1', 'ok', 900),     // before watermark — skip
      createRun('r2', 'a1', 'ok', 1500),    // after watermark — replay
      createRun('r3', 'a1', 'error', 2000), // after watermark — replay
    ]
    const mgr = makeAppManager(apps)
    const rt = makeRuntime({ a1: runs })

    await runStartupSnapshot(mgr, rt)

    const replayCalls = mockTrack.mock.calls.filter(
      ([name]) => name === 'app.run.replay'
    )
    expect(replayCalls).toHaveLength(2)
    expect(replayCalls[0][1].runId).toBe('r2')
    expect(replayCalls[1][1].runId).toBe('r3')
  })

  it('should advance watermark to latest replayed run', async () => {
    mockGetSnapshotState.mockReturnValue({ lastSnapshotTs: 0 })

    const apps = [createApp('a1')]
    const runs: AutomationRun[] = [
      createRun('r1', 'a1', 'ok', 100),
      createRun('r2', 'a1', 'ok', 500),
    ]
    const mgr = makeAppManager(apps)
    const rt = makeRuntime({ a1: runs })

    await runStartupSnapshot(mgr, rt)

    expect(mockSetSnapshotState).toHaveBeenCalledWith({
      runId: 'r2',
      ts: 500,
    })
  })

  it('should skip runs with the same runId as the watermark', async () => {
    mockGetSnapshotState.mockReturnValue({
      lastSnapshotTs: 500,
      lastSnapshotRunId: 'r2',
    })

    const apps = [createApp('a1')]
    const runs: AutomationRun[] = [
      createRun('r2', 'a1', 'ok', 500),  // matches watermark — skip
      createRun('r3', 'a1', 'ok', 600),  // after watermark — replay
    ]
    const mgr = makeAppManager(apps)
    const rt = makeRuntime({ a1: runs })

    await runStartupSnapshot(mgr, rt)

    const replayCalls = mockTrack.mock.calls.filter(
      ([name]) => name === 'app.run.replay'
    )
    expect(replayCalls).toHaveLength(1)
    expect(replayCalls[0][1].runId).toBe('r3')
  })

  it('should not replay non-terminal runs (e.g. running)', async () => {
    mockGetSnapshotState.mockReturnValue({ lastSnapshotTs: 0 })

    const apps = [createApp('a1')]
    const runs = [
      { runId: 'r1', appId: 'a1', status: 'running', triggerType: 'manual', startedAt: 100, finishedAt: 200, durationMs: 100 } as unknown as AutomationRun,
      createRun('r2', 'a1', 'ok', 300),
    ]
    const mgr = makeAppManager(apps)
    const rt = makeRuntime({ a1: runs })

    await runStartupSnapshot(mgr, rt)

    const replayCalls = mockTrack.mock.calls.filter(
      ([name]) => name === 'app.run.replay'
    )
    expect(replayCalls).toHaveLength(1)
    expect(replayCalls[0][1].runId).toBe('r2')
  })

  it('should cap replay at MAX_REPLAY_EVENTS (2000)', async () => {
    mockGetSnapshotState.mockReturnValue({ lastSnapshotTs: 0 })

    const apps = [createApp('a1')]
    const runs: AutomationRun[] = []
    for (let i = 0; i < 2100; i++) {
      runs.push(createRun(`r${i}`, 'a1', 'ok', 100 + i))
    }
    const mgr = makeAppManager(apps)
    const rt = makeRuntime({ a1: runs })

    await runStartupSnapshot(mgr, rt)

    const replayCalls = mockTrack.mock.calls.filter(
      ([name]) => name === 'app.run.replay'
    )
    // Capped at 2000 (MAX_REPLAY_EVENTS) even though 2100 candidates exist
    expect(replayCalls).toHaveLength(2000)
  })

  it('should not set watermark when no runs are replayed', async () => {
    mockGetSnapshotState.mockReturnValue({ lastSnapshotTs: 9999 })

    const apps = [createApp('a1')]
    const runs: AutomationRun[] = [
      createRun('r1', 'a1', 'ok', 100), // all below watermark
    ]
    const mgr = makeAppManager(apps)
    const rt = makeRuntime({ a1: runs })

    await runStartupSnapshot(mgr, rt)
    expect(mockSetSnapshotState).not.toHaveBeenCalled()
  })
})
