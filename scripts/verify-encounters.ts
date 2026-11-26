import { course } from '../src/features/chart/model/course'
import { useEncounter } from '../src/features/jury/model/useEncounter'
import { advanceBoat, preferredSheet } from '../src/features/sail/lib/dynamics'
import { angleDelta, distance } from '../src/shared/math'
import type { Boat, EventKind, RaceEvent, Wind } from '../src/shared/race'

declare const process: { env: Record<string, string | undefined>; exitCode?: number }

const WIND: Wind = { bearing: 265, knots: 15 }

interface Script {
  name: string
  player: Boat
  partner: Boat
  playerRudder?: (t: number, boat: Boat) => number
  partnerRudder?: (t: number, boat: Boat) => number
  limit?: number
  expect: {
    verdict: 'player' | 'partner' | 'dispute'
    penalty: number
    sequence: EventKind[]
    labels?: string[]
  }
}

const VERDICT_LABEL = { player: '你全责', partner: '对方全责', dispute: '争议' } as const

function run(script: Script): RaceEvent[] {
  const events: RaceEvent[] = []
  const encounter = useEncounter(course, (kind, label, time, position, seconds = 0) => {
    events.push({ id: String(events.length + 1), kind, label, time, position: { ...position }, penalty: seconds })
  })
  let player: Boat = { ...script.player }
  let partner: Boat = { ...script.partner }
  const dt = .025
  const limit = script.limit ?? 30
  const debug = Boolean(process.env.ENCOUNTER_DEBUG)
  for (let t = 0; t <= limit; t += dt) {
    encounter.update(player, partner, WIND, t)
    if (events.some(e => e.kind === 'verdict')) break
    if (debug && Math.abs(t / .5 - Math.round(t / .5)) < dt / 2) {
      console.log(`    t=${t.toFixed(2).padStart(6)}  你(${player.position.x.toFixed(0)},${player.position.y.toFixed(0)}) ${player.heading.toFixed(0).padStart(3)}° ${player.knots.toFixed(1)}kn` +
        `  对方(${partner.position.x.toFixed(0)},${partner.position.y.toFixed(0)}) ${partner.heading.toFixed(0).padStart(3)}° ${partner.knots.toFixed(1)}kn  距${distance(player.position, partner.position).toFixed(0)}`)
    }
    player = advanceBoat({ ...player, rudder: script.playerRudder?.(t, player) ?? 0, sheet: preferredSheet(player.heading, WIND) }, WIND, dt)
    partner = advanceBoat({ ...partner, rudder: script.partnerRudder?.(t, partner) ?? 0, sheet: preferredSheet(partner.heading, WIND) }, WIND, dt)
  }
  return events
}

const scripts: Script[] = [
  {
    // 交会一：陪练艇贴下边界航行后突然换舷取得优先，你（上风）被夹在它与边界之间，
    // 换舷一刻你已无任何无碰路线 → 对方全责。
    name: '交会一 · 贴边后突然换舷',
    player: { position: { x: 900, y: 300 }, heading: 100, knots: 8, sheet: 30, rudder: 0 },
    partner: { position: { x: 740, y: 545 }, heading: 0, knots: 11, sheet: 30, rudder: 0 },
    partnerRudder: (t, b) => t > .8 && angleDelta(b.heading, WIND.bearing) < 25 ? -1 : 0,
    expect: {
      verdict: 'partner', penalty: 0,
      sequence: ['duty', 'exhaust', 'contact', 'verdict'],
      labels: ['换舷取得优先', '未留无碰路线'],
    },
  },
  {
    // 交会二：异舷相遇，陪练艇（左舷受风）在开阔水域一直握着安全出口却不转舵 → 对方全责。
    name: '交会二 · 对手有安全出口却未转舵',
    player: { position: { x: 640, y: 300 }, heading: 200, knots: 11, sheet: 30, rudder: 0 },
    partner: { position: { x: 320, y: 327 }, heading: 320, knots: 8, sheet: 30, rudder: 0 },
    expect: {
      verdict: 'partner', penalty: 0,
      sequence: ['duty', 'exhaust', 'contact', 'verdict'],
      labels: ['有安全出口未避让'],
    },
  },
  {
    // 镜像：你（左舷受风）同样握着安全出口不转舵 → 你全责，罚时入账。
    name: '镜像 · 你有安全出口却未转舵',
    player: { position: { x: 320, y: 327 }, heading: 320, knots: 8, sheet: 30, rudder: 0 },
    partner: { position: { x: 640, y: 300 }, heading: 200, knots: 11, sheet: 30, rudder: 0 },
    expect: {
      verdict: 'player', penalty: 8,
      sequence: ['duty', 'exhaust', 'contact', 'verdict'],
      labels: ['有安全出口未避让'],
    },
  },
  {
    // 陪练艇正顶风舷别不明，交会经过无法还原 → 留作争议，不处罚。
    name: '交会三 · 舷别无法判定留作争议',
    player: { position: { x: 560, y: 320 }, heading: 207, knots: 12, sheet: 30, rudder: 0 },
    partner: { position: { x: 460, y: 270 }, heading: 265, knots: 2, sheet: 30, rudder: 0 },
    expect: {
      verdict: 'dispute', penalty: 0,
      sequence: ['contact', 'verdict'],
      labels: ['留作争议'],
    },
  },
]

let failed = 0
for (const script of scripts) {
  const events = run(script)
  console.log(`\n■ ${script.name}`)
  for (const e of events) console.log(`  ${e.time.toFixed(2).padStart(7)}s  [${e.kind}] ${e.label}${e.penalty ? `  +${e.penalty}s` : ''}`)
  const problems: string[] = []
  const kinds = events.map(e => e.kind)
  let cursor = 0
  for (const want of script.expect.sequence) {
    const at = kinds.indexOf(want, cursor)
    if (at < 0) problems.push(`缺少事件「${want}」（期望顺序 ${script.expect.sequence.join(' → ')}）`)
    else cursor = at + 1
  }
  const verdict = events.find(e => e.kind === 'verdict')
  if (!verdict) problems.push('缺少判定事件')
  else {
    if (!verdict.label.includes(VERDICT_LABEL[script.expect.verdict])) problems.push(`判定应含「${VERDICT_LABEL[script.expect.verdict]}」，实际「${verdict.label}」`)
    if (verdict.penalty !== script.expect.penalty) problems.push(`罚时应为 ${script.expect.penalty}s，实际 ${verdict.penalty}s`)
  }
  for (const text of script.expect.labels ?? []) {
    if (!events.some(e => e.label.includes(text))) problems.push(`缺少含「${text}」的事件`)
  }
  if (problems.length) {
    failed++
    for (const p of problems) console.log(`  ✗ ${p}`)
  } else {
    console.log('  ✓ 判定与证据链符合预期')
  }
}
console.log(failed ? `\n${failed} 个场景未通过` : '\n全部场景通过')
process.exitCode = failed ? 1 : 0
