/**
 * acp-vscode — UUID Unit Tests
 *
 * Tests the uuidv4() helper for format correctness and uniqueness.
 *
 * @module test/suite/uuid.test
 */

import * as assert from 'assert';
import { uuidv4 } from '../../acp/uuid';

/** RFC 4122 UUID v4 regex pattern. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

suite('uuidv4', () => {

  test('returns a string matching UUID v4 format', () => {
    const id = uuidv4();
    assert.match(
      id,
      UUID_V4_PATTERN,
      `Expected UUID v4 format, got: ${id}`
    );
  });

  test('returns unique values across multiple calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidv4()));
    assert.strictEqual(ids.size, 100, 'All 100 generated UUIDs should be unique');
  });

  test('version nibble is always 4', () => {
    for (let i = 0; i < 20; i++) {
      const id = uuidv4();
      // The 15th character (index 14) in a UUID is the version digit.
      assert.strictEqual(
        id.charAt(14),
        '4',
        `Version nibble should be "4", got: ${id}`
      );
    }
  });

  test('variant nibble is always 8, 9, a, or b', () => {
    const validVariantChars = new Set(['8', '9', 'a', 'b']);
    for (let i = 0; i < 20; i++) {
      const id = uuidv4();
      // The 20th character (index 19) is the variant nibble.
      const variant = id.charAt(19).toLowerCase();
      assert.ok(
        validVariantChars.has(variant),
        `Variant nibble should be 8/9/a/b, got: ${variant} in ${id}`
      );
    }
  });
});
