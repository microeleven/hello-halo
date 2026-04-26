/**
 * Unit tests for apps/runtime/file-export-gate
 *
 * Tests the FileExportGate security primitive that validates file paths
 * before allowing them to be sent through IM channels.
 *
 * Core invariants:
 * - Files within allowed roots are sanctioned successfully
 * - Files outside allowed roots are rejected with FileExportDeniedError
 * - Symlinks are resolved before path checking (no symlink escape)
 * - Non-existent files are rejected
 * - SanctionedFile contains the resolved real path and display name
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  FileExportGate,
  FileExportDeniedError,
} from '../../../../src/main/apps/runtime/file-export-gate'

// ============================================
// Test Fixtures
// ============================================

const TEST_DIR = join(tmpdir(), `halo-gate-test-${randomUUID().slice(0, 8)}`)
const SPACE_DIR = join(TEST_DIR, 'space')
const OUTSIDE_DIR = join(TEST_DIR, 'outside')
const NESTED_DIR = join(SPACE_DIR, 'subdir', 'deep')

beforeAll(() => {
  // Create test directory structure
  mkdirSync(NESTED_DIR, { recursive: true })
  mkdirSync(OUTSIDE_DIR, { recursive: true })

  // Create test files
  writeFileSync(join(SPACE_DIR, 'report.pdf'), 'fake pdf content')
  writeFileSync(join(NESTED_DIR, 'data.csv'), 'col1,col2\n1,2')
  writeFileSync(join(OUTSIDE_DIR, 'secret.key'), 'sensitive data')

  // Create a symlink inside space pointing outside
  const symlinkPath = join(SPACE_DIR, 'escape-link')
  if (!existsSync(symlinkPath)) {
    symlinkSync(join(OUTSIDE_DIR, 'secret.key'), symlinkPath)
  }
})

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

// ============================================
// Tests
// ============================================

describe('FileExportGate', () => {
  describe('sanction — allowed paths', () => {
    it('should sanction a file directly in the space root', () => {
      const gate = new FileExportGate([SPACE_DIR])
      const result = gate.sanction(join(SPACE_DIR, 'report.pdf'))

      expect(result.resolvedPath).toContain('report.pdf')
      expect(result.displayName).toBe('report.pdf')
    })

    it('should sanction a file in a nested subdirectory', () => {
      const gate = new FileExportGate([SPACE_DIR])
      const result = gate.sanction(join(NESTED_DIR, 'data.csv'))

      expect(result.resolvedPath).toContain('data.csv')
      expect(result.displayName).toBe('data.csv')
    })

    it('should sanction a file in tmpdir when tmpdir is allowed', () => {
      // Create a temp file in the actual tmpdir
      const tempFile = join(tmpdir(), `halo-test-${randomUUID().slice(0, 8)}.txt`)
      writeFileSync(tempFile, 'temp content')

      try {
        const gate = new FileExportGate([SPACE_DIR, tmpdir()])
        const result = gate.sanction(tempFile)
        expect(result.displayName).toContain('halo-test-')
      } finally {
        rmSync(tempFile, { force: true })
      }
    })

    it('should work with multiple allowed roots', () => {
      const gate = new FileExportGate([SPACE_DIR, OUTSIDE_DIR])
      // Both should work
      const r1 = gate.sanction(join(SPACE_DIR, 'report.pdf'))
      const r2 = gate.sanction(join(OUTSIDE_DIR, 'secret.key'))
      expect(r1.displayName).toBe('report.pdf')
      expect(r2.displayName).toBe('secret.key')
    })
  })

  describe('sanction — denied paths', () => {
    it('should reject a file outside all allowed roots', () => {
      const gate = new FileExportGate([SPACE_DIR])

      expect(() => gate.sanction(join(OUTSIDE_DIR, 'secret.key')))
        .toThrow(FileExportDeniedError)
    })

    it('should include the requested path and allowed roots in the error', () => {
      const gate = new FileExportGate([SPACE_DIR])
      const targetPath = join(OUTSIDE_DIR, 'secret.key')

      try {
        gate.sanction(targetPath)
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(FileExportDeniedError)
        const denied = err as FileExportDeniedError
        expect(denied.code).toBe('FILE_EXPORT_DENIED')
        expect(denied.requestedPath).toBe(targetPath)
        expect(denied.allowedRoots.length).toBeGreaterThan(0)
      }
    })

    it('should reject symlinks that escape the allowed root', () => {
      const gate = new FileExportGate([SPACE_DIR])
      const symlinkPath = join(SPACE_DIR, 'escape-link')

      // The symlink is inside SPACE_DIR but points to OUTSIDE_DIR
      expect(() => gate.sanction(symlinkPath))
        .toThrow(FileExportDeniedError)
    })

    it('should reject non-existent files', () => {
      const gate = new FileExportGate([SPACE_DIR])

      expect(() => gate.sanction(join(SPACE_DIR, 'does-not-exist.txt')))
        .toThrow('File not found')
    })

    it('should reject paths like /etc/passwd', () => {
      const gate = new FileExportGate([SPACE_DIR, tmpdir()])

      // /etc/passwd exists on macOS/Linux
      if (existsSync('/etc/passwd')) {
        expect(() => gate.sanction('/etc/passwd'))
          .toThrow(FileExportDeniedError)
      }
    })
  })

  describe('constructor — edge cases', () => {
    it('should filter out empty root strings', () => {
      const gate = new FileExportGate(['', SPACE_DIR, ''])
      // Should still work with SPACE_DIR
      const result = gate.sanction(join(SPACE_DIR, 'report.pdf'))
      expect(result.displayName).toBe('report.pdf')
    })

    it('should handle empty allowed roots (deny everything)', () => {
      const gate = new FileExportGate([])
      expect(() => gate.sanction(join(SPACE_DIR, 'report.pdf')))
        .toThrow(FileExportDeniedError)
    })

    it('should expose resolved roots via getter', () => {
      const gate = new FileExportGate([SPACE_DIR, tmpdir()])
      expect(gate.roots.length).toBe(2)
    })
  })
})
