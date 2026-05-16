/**
 * Minimal in-process MCP server implementation for engines that do not expose
 * Claude Agent SDK's tool() / createSdkMcpServer() helpers.
 *
 * The returned shape intentionally matches the SDK MCP server contract already
 * used by Halo's built-in tools, so application code can stay engine-agnostic.
 */

import type {
  SdkMcpServerConfigWithInstance,
  SdkMcpToolDefinition,
  SdkMcpServerInstance,
} from './types'

export function tool<Schema extends Record<string, any>>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: any, extra: unknown) => Promise<any>,
  extras?: {
    annotations?: Record<string, unknown>
    searchHint?: string
    alwaysLoad?: boolean
  }
): SdkMcpToolDefinition {
  const meta: Record<string, unknown> = {}
  if (extras?.searchHint) meta.searchHint = extras.searchHint
  if (extras?.alwaysLoad) meta.alwaysLoad = extras.alwaysLoad

  return {
    name,
    description,
    inputSchema,
    annotations: extras?.annotations,
    _meta: Object.keys(meta).length > 0 ? meta : undefined,
    handler,
  }
}

export function createSdkMcpServer(options: {
  name: string
  version?: string
  tools?: SdkMcpToolDefinition[]
}): SdkMcpServerConfigWithInstance {
  const { name, version = '1.0.0', tools = [] } = options

  const instance: SdkMcpServerInstance = {
    name,
    version,
    tools,
    async callTool(toolName: string, args: Record<string, unknown>) {
      const def = tools.find((candidate) => candidate.name === toolName)
      if (!def) return undefined
      return def.handler(args, {})
    },
    listTools() {
      return tools.map((def) => ({
        name: def.name,
        description: def.description,
        inputSchema: schemaToJson(def.inputSchema),
        annotations: def.annotations,
      }))
    },
  }

  return {
    type: 'sdk',
    name,
    instance,
  }
}

function schemaToJson(schema: Record<string, any>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(schema || {})) {
    properties[key] = zodLikeToJsonSchema(value)
    if (!isOptionalZodLike(value)) required.push(key)
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

function zodLikeToJsonSchema(value: any): Record<string, unknown> {
  const def = value?._def
  const typeName = def?.typeName || def?.type

  if (typeName === 'ZodNumber' || typeName === 'number') return { type: 'number' }
  if (typeName === 'ZodBoolean' || typeName === 'boolean') return { type: 'boolean' }
  if (typeName === 'ZodArray' || typeName === 'array') return { type: 'array' }
  if (typeName === 'ZodObject' || typeName === 'object') return { type: 'object' }
  if (typeName === 'ZodEnum' && Array.isArray(def?.values)) return { type: 'string', enum: def.values }
  if (typeName === 'ZodOptional' || typeName === 'optional') {
    return zodLikeToJsonSchema(def?.innerType)
  }

  return { type: 'string' }
}

function isOptionalZodLike(value: any): boolean {
  const def = value?._def
  return def?.typeName === 'ZodOptional' || def?.type === 'optional' || typeof value?.isOptional === 'function' && value.isOptional()
}
