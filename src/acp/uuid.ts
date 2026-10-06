/**
 * acp-vscode — UUID utility (no external dependency)
 *
 * A minimal crypto-based UUID v4 generator using Node's built-in
 * `crypto.randomUUID()` (Node 14.17+). Falls back to a Math.random
 * implementation for environments that don't expose the API.
 *
 * @module acp/uuid
 */

import * as crypto from 'crypto';

/**
 * Returns a RFC 4122 version 4 UUID string.
 * Uses `crypto.randomUUID()` when available for cryptographic quality.
 */
export function uuidv4(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for older Node versions.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
