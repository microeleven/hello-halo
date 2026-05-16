/**
 * Unit Tests: services/agent/codex — JSON-RPC client (in-memory streams)
 *
 * Asserts wire-level behavior: line-delimited JSON framing, no jsonrpc:"2.0"
 * field, request/response correlation, server-request dispatch, transport
 * close cleanup.
 */

import { describe, expect, it } from 'vitest'
import { PassThrough } from 'stream'
import { JsonRpcClient } from '../../../../../src/main/services/agent/codex/transport/jsonrpc-client'

function makeClient() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const client = new JsonRpcClient({ stdin, stdout })

  const written: string[] = []
  stdin.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line) written.push(line)
    }
  })

  return { stdin, stdout, client, written }
}

function emit(stream: PassThrough, msg: object): void {
  stream.write(JSON.stringify(msg) + '\n')
}

describe('JsonRpcClient', () => {
  it('frames an outgoing request as a single JSON line with no jsonrpc field', async () => {
    const { client, stdout, written } = makeClient()
    const promise = client.request<{ ok: true }>('initialize', { capabilities: { experimentalApi: true } })
    await new Promise((resolve) => setImmediate(resolve))
    expect(written).toHaveLength(1)
    const sent = JSON.parse(written[0])
    expect(sent).toMatchObject({ method: 'initialize', params: { capabilities: { experimentalApi: true } } })
    expect(sent.jsonrpc).toBeUndefined()
    expect(typeof sent.id).toBe('number')

    emit(stdout, { id: sent.id, result: { ok: true } })
    await expect(promise).resolves.toEqual({ ok: true })
    client.close()
  })

  it('rejects with the server error payload and surfaces error code + data', async () => {
    const { client, stdout, written } = makeClient()
    const promise = client.request('thread/start', {})
    await new Promise((resolve) => setImmediate(resolve))
    const id = JSON.parse(written[0]).id
    emit(stdout, { id, error: { code: -32602, message: 'invalid params', data: { field: 'model' } } })
    await expect(promise).rejects.toThrow(/invalid params \(code -32602\)/)
    client.close()
  })

  it('dispatches notifications to subscribed listeners only', async () => {
    const { client, stdout } = makeClient()
    const aSeen: unknown[] = []
    const bSeen: unknown[] = []
    client.onNotification('item/agentMessage/delta', (p) => aSeen.push(p))
    client.onNotification('turn/completed', (p) => bSeen.push(p))

    emit(stdout, { method: 'item/agentMessage/delta', params: { delta: 'a' } })
    emit(stdout, { method: 'turn/completed', params: { threadId: 't', turnId: 'r' } })
    emit(stdout, { method: 'unhandled', params: {} })
    await new Promise((resolve) => setImmediate(resolve))

    expect(aSeen).toEqual([{ delta: 'a' }])
    expect(bSeen).toEqual([{ threadId: 't', turnId: 'r' }])
    client.close()
  })

  it('answers server requests with the handler result preserving the id', async () => {
    const { client, stdout, written } = makeClient()
    client.onServerRequest('item/commandExecution/requestApproval', async () => ({ decision: 'approved' }))
    emit(stdout, { id: 42, method: 'item/commandExecution/requestApproval', params: { command: 'ls' } })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(written).toHaveLength(1)
    const reply = JSON.parse(written[0])
    expect(reply).toEqual({ id: 42, result: { decision: 'approved' } })
    client.close()
  })

  it('reports method-not-found for unhandled server requests', async () => {
    const { client, stdout, written } = makeClient()
    emit(stdout, { id: 'r-7', method: 'item/tool/call', params: {} })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const reply = JSON.parse(written[0])
    expect(reply.id).toBe('r-7')
    expect(reply.error.code).toBe(-32601)
    expect(reply.error.message).toMatch(/Unhandled server request/)
    client.close()
  })

  it('rejects pending requests when the connection closes', async () => {
    const { client, stdout, written } = makeClient()
    const a = client.request('thread/start', {})
    const b = client.request('turn/start', {})
    await new Promise((resolve) => setImmediate(resolve))
    expect(written).toHaveLength(2)
    stdout.end()
    await expect(a).rejects.toThrow(/connection closed/)
    await expect(b).rejects.toThrow(/connection closed/)
  })

  it('drops non-JSON lines without throwing', async () => {
    const { client, stdout } = makeClient()
    let parseErrors = 0
    const mute = console.warn
    console.warn = () => { parseErrors++ }
    try {
      stdout.write('this is not json\n')
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      console.warn = mute
    }
    expect(parseErrors).toBeGreaterThan(0)
    client.close()
  })

  it('returns false from isOpen after close', () => {
    const { client } = makeClient()
    expect(client.isOpen()).toBe(true)
    client.close()
    expect(client.isOpen()).toBe(false)
  })
})
