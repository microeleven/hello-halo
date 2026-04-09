/**
 * @module tools/send-message
 * SendMessageTool — send a message to another agent or broadcast.
 *
 * This is a stub — actual message routing is done by the orchestrator.
 * Includes `setMessageRouter()` for the orchestrator to register the real handler.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  SEND_MESSAGE_TOOL_NAME,
  SEND_MESSAGE_TOOL_DESCRIPTION,
  SEND_MESSAGE_TOOL_INPUT_SCHEMA,
} from './schema.js';

// ---------------------------------------------------------------------------
// Structured protocol message types
// ---------------------------------------------------------------------------

export interface ShutdownRequest {
  type: 'shutdown_request';
  reason?: string;
}

export interface ShutdownResponse {
  type: 'shutdown_response';
  request_id: string;
  approve: boolean;
  reason?: string;
}

export interface PlanApprovalResponse {
  type: 'plan_approval_response';
  request_id: string;
  approve: boolean;
  feedback?: string;
}

export type StructuredMessage =
  | ShutdownRequest
  | ShutdownResponse
  | PlanApprovalResponse;

// ---------------------------------------------------------------------------
// In-process inbox (per-session scoped)
// ---------------------------------------------------------------------------

export interface AgentMessage {
  from: string;
  to: string;
  content: string;
  timestamp: number;
}

/**
 * Per-session inbox store. Keyed by sessionId, then by recipient name.
 * Prevents message leaks across independent sessions.
 */
const sessionInboxes = new Map<string, Map<string, AgentMessage[]>>();

/** Get or create the inbox map for a session. */
function getSessionInbox(sessionId: string): Map<string, AgentMessage[]> {
  let inbox = sessionInboxes.get(sessionId);
  if (!inbox) {
    inbox = new Map();
    sessionInboxes.set(sessionId, inbox);
  }
  return inbox;
}

/** Remove and return all messages queued for `recipient` in a session. */
export function drainInbox(recipient: string, sessionId: string): AgentMessage[] {
  const inbox = sessionInboxes.get(sessionId);
  if (!inbox) return [];
  const messages = inbox.get(recipient) ?? [];
  inbox.delete(recipient);
  return messages;
}

/** Read (without removing) all messages queued for `recipient` in a session. */
export function peekInbox(recipient: string, sessionId: string): AgentMessage[] {
  const inbox = sessionInboxes.get(sessionId);
  if (!inbox) return [];
  return inbox.get(recipient) ?? [];
}

/** Clean up all inboxes for a session. */
export function clearSessionInbox(sessionId: string): void {
  sessionInboxes.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Message router injection (set by orchestrator)
// ---------------------------------------------------------------------------

export type MessageRouter = (
  to: string,
  message: string | StructuredMessage,
  summary: string | undefined,
  ctx: ToolContext,
) => Promise<ToolResult>;

let _messageRouter: MessageRouter | null = null;
/** Session ID that owns the current router — prevents cross-session leaks. */
let _routerSessionId: string | null = null;

/**
 * Register the real message router. Called by the orchestrator.
 * Pass `null` to reset to default inbox mode.
 *
 * @param sessionId - When provided, tags the router to a specific session
 *   so stale routers from old sessions are not accidentally reused.
 */
export function setMessageRouter(
  router: MessageRouter | null,
  sessionId?: string,
): void {
  _messageRouter = router;
  _routerSessionId = sessionId ?? null;
}

// ---------------------------------------------------------------------------
// SendMessageTool
// ---------------------------------------------------------------------------

export const SendMessageTool: Tool = {
  name: SEND_MESSAGE_TOOL_NAME,
  description: SEND_MESSAGE_TOOL_DESCRIPTION,
  inputSchema: SEND_MESSAGE_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const to = input.to as string | undefined;
    const rawMessage = input.message as string | StructuredMessage | undefined;
    const summary = input.summary as string | undefined;

    if (!to || typeof to !== 'string') {
      return toolError('Missing required parameter: to');
    }
    if (rawMessage === undefined || rawMessage === null) {
      return toolError('Missing required parameter: message');
    }

    // Determine if the message is structured or plain text
    const isStructured = typeof rawMessage === 'object' && rawMessage !== null && 'type' in rawMessage;

    if (typeof rawMessage === 'string' && !rawMessage.trim()) {
      return toolError('Message cannot be empty.');
    }

    // If a real router is registered, use it.
    // Validate session ownership to prevent cross-session leaks (H1).
    if (_messageRouter) {
      if (_routerSessionId && ctx.sessionId && _routerSessionId !== ctx.sessionId) {
        return toolError('Message router belongs to a different session. Re-initialize the orchestrator.');
      }
      return _messageRouter(to, rawMessage, summary, ctx);
    }

    // Handle structured protocol messages in stub mode
    if (isStructured) {
      const structured = rawMessage as StructuredMessage;
      switch (structured.type) {
        case 'shutdown_request':
          return toolSuccess(
            `Shutdown request sent to '${to}'${structured.reason ? `: ${structured.reason}` : ''}`,
          );
        case 'shutdown_response':
          return toolSuccess(
            `Shutdown ${structured.approve ? 'approved' : 'rejected'} (request_id: ${structured.request_id})`,
          );
        case 'plan_approval_response':
          return toolSuccess(
            `Plan ${structured.approve ? 'approved' : 'rejected'} for '${to}' (request_id: ${structured.request_id})${structured.feedback ? `: ${structured.feedback}` : ''}`,
          );
        default:
          return toolError(`Unknown structured message type`);
      }
    }

    // Plain text message — use per-session inbox
    const message = rawMessage as string;
    const now = Math.floor(Date.now() / 1000);
    const msg: AgentMessage = {
      from: ctx.sessionId,
      to,
      content: message,
      timestamp: now,
    };

    const preview = summary ?? message.slice(0, 60);
    const inbox = getSessionInbox(ctx.sessionId);

    if (to === '*') {
      // Broadcast
      const recipients = Array.from(inbox.keys());
      if (recipients.length === 0) {
        return toolSuccess(
          'Broadcast queued (no active recipient inboxes yet).',
        );
      }
      for (const key of recipients) {
        const existing = inbox.get(key) ?? [];
        existing.push({ ...msg });
        inbox.set(key, existing);
      }
      return toolSuccess(
        `Broadcast to ${recipients.length} agent(s): ${preview}`,
      );
    }

    // Directed message
    const existing = inbox.get(to) ?? [];
    existing.push(msg);
    inbox.set(to, existing);

    return toolSuccess(`Message sent to '${to}': ${preview}`);
  },
};
