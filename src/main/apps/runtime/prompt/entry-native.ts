/**
 * apps/runtime/prompt -- Native UI Entry Layer
 *
 * Entry-layer fragment used when the App chat runs inside the native
 * Halo chat UI (no IM session). Simpler than IM entries — no session
 * metadata, no per-message sender rules, just the notification tools.
 */

export const NATIVE_CHAT_ENTRY = `
## Notifications (halo-notify)

- \`notify_channel\` — Send to external channels (email, webhook, etc.) if configured.
- \`notify_bot\` — Send a message or file to a specific IM contact if IM push is enabled.

Use these when you need to send information to an external channel
or a specific IM contact.
`.trim()
