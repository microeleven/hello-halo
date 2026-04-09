/**
 * @module tools/send-message/schema
 * SendMessage tool schema and configuration.
 * @license MIT
 */

export const SEND_MESSAGE_TOOL_NAME = 'SendMessage';

export const SEND_MESSAGE_TOOL_DESCRIPTION =
  'Send a message to another agent by name, or broadcast to all active agents with to="*". ' +
  'Recipients accumulate messages in their inbox and can retrieve them. ' +
  'Use this for coordination between concurrent sub-agents.';

/**
 * Structured protocol message types that can be sent alongside plain text.
 * Matches the CC official SendMessageTool schema.
 */
const shutdownRequestSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['shutdown_request'] },
    reason: { type: 'string' },
  },
  required: ['type'],
} as const;

const shutdownResponseSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['shutdown_response'] },
    request_id: { type: 'string' },
    approve: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['type', 'request_id', 'approve'],
} as const;

const planApprovalResponseSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['plan_approval_response'] },
    request_id: { type: 'string' },
    approve: { type: 'boolean' },
    feedback: { type: 'string' },
  },
  required: ['type', 'request_id', 'approve'],
} as const;

export const SEND_MESSAGE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    to: {
      type: 'string',
      description:
        'Recipient: teammate name, or "*" for broadcast to all teammates',
    },
    summary: {
      type: 'string',
      description:
        'A 5-10 word summary shown as a preview in the UI (required when message is a string)',
    },
    message: {
      anyOf: [
        { type: 'string', description: 'Plain text message content' },
        {
          anyOf: [
            shutdownRequestSchema,
            shutdownResponseSchema,
            planApprovalResponseSchema,
          ],
        },
      ],
    },
  },
  required: ['to', 'message'],
} as const;
