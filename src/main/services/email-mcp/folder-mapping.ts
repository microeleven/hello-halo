/**
 * Email MCP — IMAP Folder Name Mapping
 *
 * Handles mapping between user-friendly folder names and IMAP-encoded names.
 * Many IMAP servers use modified UTF-7 encoding (RFC 3501) for non-ASCII folder names.
 */

// ============================================
// Modified UTF-7 Codec (RFC 3501 / IMAP)
// ============================================

/**
 * Encode a Unicode string to modified UTF-7 for IMAP.
 *
 * Modified UTF-7 differs from standard UTF-7:
 * - Uses '&' instead of '+' as shift character
 * - Uses ',' instead of '/' in Base64 alphabet
 * - Literal '&' is encoded as '&-'
 */
export function encodeModifiedUtf7(input: string): string {
  let result = ''
  let nonAsciiBuffer = ''

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const code = ch.charCodeAt(0)

    if (code >= 0x20 && code <= 0x7e) {
      // Flush any buffered non-ASCII
      if (nonAsciiBuffer.length > 0) {
        result += '&' + encodeUtf16ToBase64(nonAsciiBuffer) + '-'
        nonAsciiBuffer = ''
      }
      // Literal '&' -> '&-'
      if (ch === '&') {
        result += '&-'
      } else {
        result += ch
      }
    } else {
      nonAsciiBuffer += ch
    }
  }

  // Flush remaining buffer
  if (nonAsciiBuffer.length > 0) {
    result += '&' + encodeUtf16ToBase64(nonAsciiBuffer) + '-'
  }

  return result
}

/**
 * Decode a modified UTF-7 IMAP folder name to Unicode.
 */
export function decodeModifiedUtf7(input: string): string {
  let result = ''
  let i = 0

  while (i < input.length) {
    if (input[i] === '&') {
      if (input[i + 1] === '-') {
        result += '&'
        i += 2
      } else {
        const end = input.indexOf('-', i + 1)
        if (end === -1) {
          // Malformed — return as-is
          result += input.slice(i)
          break
        }
        const encoded = input.slice(i + 1, end)
        result += decodeBase64ToUtf16(encoded)
        i = end + 1
      }
    } else {
      result += input[i]
      i++
    }
  }

  return result
}

function encodeUtf16ToBase64(str: string): string {
  const buf = Buffer.alloc(str.length * 2)
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16BE(str.charCodeAt(i), i * 2)
  }
  // Standard base64, then replace '/' with ','
  return buf.toString('base64').replace(/\//g, ',').replace(/=+$/, '')
}

function decodeBase64ToUtf16(encoded: string): string {
  // Replace ',' back with '/' and pad
  const base64 = encoded.replace(/,/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const buf = Buffer.from(padded, 'base64')
  let result = ''
  for (let i = 0; i + 1 < buf.length; i += 2) {
    result += String.fromCharCode(buf.readUInt16BE(i))
  }
  return result
}

// ============================================
// Well-Known IMAP Folder Mappings
// ============================================

/**
 * Well-known IMAP folder name mappings (modified UTF-7 encoded).
 * Used as fallback when the IMAP server doesn't provide LIST flags.
 * These encodings are standard across servers that use CJK folder names.
 */
const KNOWN_FOLDER_MAP: Record<string, string> = {
  'INBOX': 'INBOX',
  'Drafts': '&g0l6P3ux-',
  'Sent': '&XfJT0ZAB-',
  'Trash': '&XfJSIJZk-',
  'Junk': '&V4NXPpCuTvY-',
}

// Reverse map: encoded -> friendly
const REVERSE_FOLDER_MAP: Record<string, string> = {}
for (const [friendly, encoded] of Object.entries(KNOWN_FOLDER_MAP)) {
  REVERSE_FOLDER_MAP[encoded] = friendly
}

// ============================================
// Folder Resolution
// ============================================

/** System folder type identifiers */
export type SystemFolderType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk'

/** Folder info returned to AI tools */
export interface FolderInfo {
  /** Raw IMAP folder name (may be encoded) */
  name: string
  /** Human-readable display name */
  displayName: string
  /** Whether this is a system folder */
  type: 'system' | 'custom'
}

/**
 * Resolve a user-friendly folder name to the actual IMAP folder name.
 *
 * Accepts:
 * - Already-encoded names (passed through)
 * - Case-insensitive friendly names: "Inbox", "sent", "DRAFTS", etc.
 * - Already-correct names like "INBOX"
 *
 * @param folderName - User-provided folder name
 * @param knownFolders - Map of encoded IMAP names discovered via LIST (optional)
 * @returns The IMAP folder name to use
 */
export function resolveImapFolderName(
  folderName: string,
  knownFolders?: Map<string, FolderInfo>
): string {
  // 1. If it matches a known folder exactly, use it
  if (knownFolders?.has(folderName)) {
    return folderName
  }

  // 2. Case-insensitive lookup against known folder display names
  if (knownFolders) {
    const lower = folderName.toLowerCase()
    for (const [encoded, info] of knownFolders) {
      if (info.displayName.toLowerCase() === lower) {
        return encoded
      }
    }
  }

  // 3. Check against well-known folder mappings
  const coreLookup = Object.entries(KNOWN_FOLDER_MAP).find(
    ([friendly]) => friendly.toLowerCase() === folderName.toLowerCase()
  )
  if (coreLookup) {
    return coreLookup[1]
  }

  // 4. Return as-is (may be an already-encoded name or custom folder)
  return folderName
}

/**
 * Get a human-readable display name for an IMAP folder.
 *
 * @param imapName - Raw IMAP folder name
 * @returns Decoded display name
 */
export function getFolderDisplayName(imapName: string): string {
  // Check reverse well-known map first
  if (REVERSE_FOLDER_MAP[imapName]) {
    return REVERSE_FOLDER_MAP[imapName]
  }

  // Attempt to decode modified UTF-7
  if (imapName.includes('&') && imapName !== '&-') {
    return decodeModifiedUtf7(imapName)
  }

  return imapName
}

/**
 * Determine the system folder type from IMAP LIST flags or folder name.
 */
export function identifySystemFolder(
  imapName: string,
  flags?: Set<string>
): SystemFolderType | null {
  // Check LIST flags first
  if (flags) {
    if (flags.has('\\Inbox') || imapName === 'INBOX') return 'inbox'
    if (flags.has('\\Sent')) return 'sent'
    if (flags.has('\\Drafts')) return 'drafts'
    if (flags.has('\\Trash')) return 'trash'
    if (flags.has('\\Junk')) return 'junk'
  }

  // Fallback: check known names
  const lower = imapName.toLowerCase()
  if (lower === 'inbox') return 'inbox'

  // Check well-known folder mappings
  const friendly = REVERSE_FOLDER_MAP[imapName]
  if (friendly) {
    const map: Record<string, SystemFolderType> = {
      'Sent': 'sent', 'Drafts': 'drafts', 'Trash': 'trash', 'Junk': 'junk'
    }
    return map[friendly] ?? null
  }

  return null
}
