/**
 * Emulation Tools (1 tool)
 *
 * Device, network, and geolocation emulation.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { BrowserContext } from '../context'
import { textResult } from './helpers'

const NETWORK_CONDITIONS: Record<string, { download: number; upload: number; latency: number }> = {
  'Slow 3G': { download: 500 * 1024 / 8, upload: 500 * 1024 / 8, latency: 400 },
  'Fast 3G': { download: 1.6 * 1024 * 1024 / 8, upload: 750 * 1024 / 8, latency: 150 },
  'Regular 4G': { download: 4 * 1024 * 1024 / 8, upload: 3 * 1024 * 1024 / 8, latency: 20 },
  'DSL': { download: 2 * 1024 * 1024 / 8, upload: 1 * 1024 * 1024 / 8, latency: 5 },
  'WiFi': { download: 30 * 1024 * 1024 / 8, upload: 15 * 1024 * 1024 / 8, latency: 2 }
}

export function buildEmulationTools(ctx: BrowserContext) {

const browser_emulate = tool(
  'browser_emulate',
  'Emulates various features on the selected page.',
  {
    networkConditions: z.enum([
      'No emulation', 'Offline', 'Slow 3G', 'Fast 3G', 'Regular 4G', 'DSL', 'WiFi'
    ]).optional().describe('Throttle network. Set to "No emulation" to disable. If omitted, conditions remain unchanged.'),
    cpuThrottlingRate: z.number().min(1).max(20).optional().describe('Represents the CPU slowdown factor. Set the rate to 1 to disable throttling. If omitted, throttling remains unchanged.'),
    geolocation: z.object({
      latitude: z.number().min(-90).max(90).describe('Latitude between -90 and 90.'),
      longitude: z.number().min(-180).max(180).describe('Longitude between -180 and 180.')
    }).nullable().optional().describe('Geolocation to emulate. Set to null to clear the geolocation override.')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    const results: string[] = []

    try {
      // Network conditions
      if (args.networkConditions !== undefined) {
        if (args.networkConditions === 'No emulation') {
          await ctx.sendCDPCommand('Network.emulateNetworkConditions', {
            offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
          })
          results.push('Network: No emulation')
        } else if (args.networkConditions === 'Offline') {
          await ctx.sendCDPCommand('Network.emulateNetworkConditions', {
            offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
          })
          results.push('Network: Offline')
        } else if (args.networkConditions in NETWORK_CONDITIONS) {
          const cond = NETWORK_CONDITIONS[args.networkConditions]
          await ctx.sendCDPCommand('Network.emulateNetworkConditions', {
            offline: false, latency: cond.latency,
            downloadThroughput: cond.download, uploadThroughput: cond.upload
          })
          results.push(`Network: ${args.networkConditions}`)
        }
      }

      // CPU throttling
      if (args.cpuThrottlingRate !== undefined) {
        await ctx.sendCDPCommand('Emulation.setCPUThrottlingRate', {
          rate: args.cpuThrottlingRate
        })
        results.push(`CPU throttling: ${args.cpuThrottlingRate}x`)
      }

      // Geolocation
      if (args.geolocation !== undefined) {
        if (args.geolocation === null) {
          await ctx.sendCDPCommand('Emulation.clearGeolocationOverride')
          results.push('Geolocation: cleared')
        } else {
          await ctx.sendCDPCommand('Emulation.setGeolocationOverride', {
            latitude: args.geolocation.latitude,
            longitude: args.geolocation.longitude,
            accuracy: 100
          })
          results.push(`Geolocation: ${args.geolocation.latitude}, ${args.geolocation.longitude}`)
        }
      }

      if (results.length === 0) {
        return textResult('No emulation settings changed.')
      }

      return textResult(results.join('\n'))
    } catch (error) {
      return textResult(`Emulation failed: ${(error as Error).message}`, true)
    }
  }
)

return [
  browser_emulate
]

} // end buildEmulationTools
