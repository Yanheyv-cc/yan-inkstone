/**
 * 冒烟测试：不装进 DSH 也能跑。用一个假 ctx 接住 register，然后直接调 execute。
 * 跑法：node test/smoke.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const root = mkdtempSync(join(tmpdir(), 'yan-test-'))
const tools = new Map()
const ctx = { tools: { register: (t) => tools.set(t.name, t) } }

apply(ctx, { root })

assert.deepEqual([...tools.keys()].sort(), ['yan_open', 'yan_recall', 'yan_remember', 'yan_status'].sort(), '四个工具都注册了')

const call = async (name, args) => tools.get(name).execute(args, { signal: new AbortController().signal })

// ── 记 ──
const r1 = await call('yan_remember', { text: '测试：鱼小水的身体不该再穿', kind: 'decision', tags: ['边界'] })
assert.equal(r1.verified, true, '回执要验过')
assert.ok(r1.file.endsWith('.md'))
const page = readFileSync(r1.file, 'utf8')
assert.match(page, /鱼小水的身体不该再穿/, '记忆页里要有这句')
const idx = readFileSync(join(root, 'memory', 'index.jsonl'), 'utf8').trim().split('\n')
assert.equal(idx.length, 1)
assert.equal(JSON.parse(idx[0]).id, r1.id)

// ── 翻 ──
const r2 = await call('yan_recall', { query: '鱼小水' })
assert.equal(r2.total, 1)
assert.equal(r2.returned, 1)
assert.equal(r2.entries[0].id, r1.id)
const r2b = await call('yan_recall', { query: '不存在的词' })
assert.equal(r2b.returned, 0)

// ── 欠 ──
const o1 = await call('yan_open', { action: 'add', what: '把信转给鱼小水', note: '等 cc' })
assert.equal(o1.items.length, 1)
const oid = o1.items[0].id
const o2 = await call('yan_open', { action: 'done', id: oid })
assert.equal(o2.items.length, 0, '勾掉之后不该还在欠单上')
const raw = JSON.parse(readFileSync(join(root, 'memory', 'open.json'), 'utf8'))
assert.equal(raw.items[0].done, true)

// ── 看 ──
const s = await call('yan_status', {})
assert.match(s.now, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '时间要给本地时间，不是 UTC')
assert.equal(s.memory.total, 1)
assert.equal(s.memory.today, 1)
assert.equal(s.open, 0)
assert.equal(s.backup.file, '', '临时目录里没有备份包')
assert.ok(s.machine.uptimeHours > 0)

// ── 出错的路也要走一遍 ──
await assert.rejects(() => call('yan_remember', { text: '   ' }), /text 是空的/)
await assert.rejects(() => call('yan_open', { action: 'done', id: 'o-nope' }), /没找到要勾掉的欠条/)
await assert.rejects(() => call('yan_remember', { text: 'x'.repeat(5000) }), /太长/)

// ── 备份校验 ──
const { createHash } = await import('node:crypto')
const fake = join(root, 'backups', 'yan-test.tgz')
const { mkdirSync } = await import('node:fs')
mkdirSync(join(root, 'backups'), { recursive: true })
writeFileSync(fake, 'not really a tarball')
writeFileSync(join(root, 'backups', 'SHA256SUMS'), `${createHash('sha256').update('not really a tarball').digest('hex')}  yan-test.tgz\n`)
const s2 = await call('yan_status', {})
assert.equal(s2.backup.verified, true, 'sha256 对得上要报 verified')

// ── 原子写没留垃圾 ──
const { readdirSync } = await import('node:fs')
assert.deepEqual(readdirSync(join(root, 'memory')).filter((f) => f.includes('.tmp-')), [])

rmSync(root, { recursive: true, force: true })
console.log('✓ 全部通过：记 / 翻 / 欠 / 看 / 出错的路 / 备份校验 / 原子写')
