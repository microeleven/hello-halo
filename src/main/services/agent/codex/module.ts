/**
 * Codex engine facade implementing Halo's SDK module contract.
 */

import { CodexSessionAdapter } from './session-adapter'
import { tool, createSdkMcpServer } from './mcp-server'
import type { CodexModuleRuntime, CodexSdkModule } from './types'

export function createCodexSdkModule(runtime: CodexModuleRuntime): CodexSdkModule {
  return {
    tool,
    createSdkMcpServer,
    async createSession(options: Record<string, any>) {
      return CodexSessionAdapter.create(runtime, options)
    },
    query(params: any) {
      return queryCodex(runtime, params)
    },
  }
}

async function* queryCodex(runtime: CodexModuleRuntime, params: any): AsyncGenerator<any> {
  const session = await CodexSessionAdapter.create(runtime, {
    ...(params?.options || {}),
    resume: params?.options?.resume,
  })
  try {
    session.send(params?.prompt || 'hi')
    yield* session.stream()
  } finally {
    session.close()
  }
}
