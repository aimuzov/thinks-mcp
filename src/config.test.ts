import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('keeps the corpus outside the installed package', () => {
    const cfg = loadConfig({})
    expect(cfg.dataDir).toBe(join(homedir(), '.config', 'aimuzov-thinks-mcp'))
    expect(cfg.dbPath).toBe(join(cfg.dataDir, 'style.db'))
    // A path inside node_modules or a mise cache would be wiped on upgrade.
    expect(cfg.dbPath).not.toMatch(/node_modules|\/build\//)
  })

  it('honours XDG_CONFIG_HOME', () => {
    const cfg = loadConfig({ XDG_CONFIG_HOME: '/tmp/xdg' })
    expect(cfg.dataDir).toBe('/tmp/xdg/aimuzov-thinks-mcp')
  })

  it('lets THINKS_DATA_DIR override everything derived from it', () => {
    const cfg = loadConfig({ THINKS_DATA_DIR: '/srv/thinks' })
    expect(cfg.dbPath).toBe('/srv/thinks/style.db')
    expect(cfg.dumpPath).toBe('/srv/thinks/dump.json')
  })

  it('lets THINKS_DB point somewhere else entirely', () => {
    const cfg = loadConfig({
      THINKS_DATA_DIR: '/srv/thinks',
      THINKS_DB: '/mnt/big/style.db',
    })
    expect(cfg.dbPath).toBe('/mnt/big/style.db')
    expect(cfg.dataDir).toBe('/srv/thinks')
  })

  it('parses tuning knobs and falls back to defaults', () => {
    const cfg = loadConfig({
      THINKS_BURST_WINDOW: '120',
      THINKS_HOLDOUT: 'нечисло',
      THINKS_CHAT_STOPLIST: ' Чат один , Чат два ,,',
    })
    expect(cfg.burstWindowSeconds).toBe(120)
    expect(cfg.holdoutSize).toBe(20)
    expect(cfg.longformMinChars).toBe(300)
    expect(cfg.chatStopList).toEqual(['Чат один', 'Чат два'])
  })
})
