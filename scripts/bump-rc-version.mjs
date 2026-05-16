#!/usr/bin/env node
/**
 * Bump RC version before internal builds.
 *
 * Rules (matches the trailing -rc.N segment, regardless of what precedes it):
 *   2.1.7              → 2.1.7-rc.1            (stable → append rc.1)
 *   2.1.7-rc.1         → 2.1.7-rc.2            (rc → increment rc number)
 *   2.1.9-dev.0        → 2.1.9-dev.0-rc.1      (prerelease base → append rc.1)
 *   2.1.9-dev.0-rc.1   → 2.1.9-dev.0-rc.2      (prerelease+rc → increment rc number)
 *
 * The match is anchored to the END of the string only, so an existing
 * prerelease tag (e.g. -dev.0) is preserved and rc segments never stack.
 *
 * To release a new stable version, manually run: npm version patch/minor/major
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '../package.json')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const current = pkg.version

let next

const trailingRc = current.match(/^(.*)-rc\.(\d+)$/)
if (trailingRc) {
  // Already ends with -rc.N: bump rc number, keep everything before it
  const prefix = trailingRc[1]
  const rcNum = parseInt(trailingRc[2], 10)
  next = `${prefix}-rc.${rcNum + 1}`
} else {
  // No trailing rc segment: append rc.1
  next = `${current}-rc.1`
}

pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

console.log(`version bumped: ${current} → ${next}`)
