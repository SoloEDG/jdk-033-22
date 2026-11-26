import { distance } from '../../../shared/math'
import type { Boat, Course, EventKind, Point, Wind } from '../../../shared/race'
import { CONTACT_DISTANCE, escapeRoutes, hasClearRoute, rightOfWay, tackOf, type Side, type Tack } from '../lib/rightOfWay'

type AddEvent = (kind: EventKind, label: string, time: number, position: Point, seconds?: number) => void

const ENGAGE_DISTANCE = 220    // 两船进入此距离开始跟踪交会
const DISENGAGE_DISTANCE = 260  // 脱离此距离结束本次交会
const TACK_GRACE = 6            // 换舷后多少秒内取得优先仍算"刚换舷"
const ROUTE_CHECK_STEP = .12    // 无碰路线推演的检查间隔（秒）
const CLEAR_WINDOW = 1.2        // 让路方至少拥有这么久的无碰出口才算"有安全出口"
const FAULT_PENALTY = 8

const who = (side: Side) => side === 'player' ? '你' : '对方'
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

interface Acquisition { by: Side; giveWay: Side; at: number; leftRoute: boolean }

/**
 * 陪练艇交会裁判：跟踪两船从相遇到接触的全程，
 * 依次记录"避让义务形成 → 避让机会耗尽 → 实际接触"的证据，接触时判定责任。
 * 刚换舷取得优先的一方，必须在取得优先一刻给对手留出至少一条
 * 凭当时舵、帆和速度能走通的无碰路线；该记录一旦形成便保留到本次交会结束——
 * 让路方只剩触礁、出界或撞船路线时，优先方不能用碰撞一刻的船位免责。
 * 证据不足时留作争议，不处罚。
 */
export function useEncounter(course: Course, add: AddEvent) {
  let engaged = false
  let duty: { giveWay: Side; since: number } | null = null
  let acquisition: Acquisition | null = null
  let lastClear = -1        // 当前让路方最后一次仍有无碰路线的时刻
  let exhausted = false
  let contacted = false
  let routeCheckAt = -1
  // 舷别轨迹：changedAt 是最近一次"换舷"（舷别发生可判定变化）的时刻。
  // 正顶风/正顺风时舷别不明，保留上一次可判定舷别，不刷新 changedAt。
  const tacks: Record<Side, { now: Tack | null; changedAt: number }> = {
    player: { now: null, changedAt: -Infinity },
    partner: { now: null, changedAt: -Infinity },
  }

  function reset() {
    engaged = false
    close()
    tacks.player = { now: null, changedAt: -Infinity }
    tacks.partner = { now: null, changedAt: -Infinity }
  }

  function close() {
    engaged = false
    duty = null
    acquisition = null
    lastClear = -1
    exhausted = false
    contacted = false
    routeCheckAt = -1
  }

  function track(side: Side, boat: Boat, wind: Wind, time: number) {
    const tack = tackOf(boat, wind)
    if (!tack || tack === tacks[side].now) return
    // 首次观测到舷别不算换舷；只有从已判定舷别换到另一舷才记录换舷时刻
    if (tacks[side].now) tacks[side].changedAt = time
    tacks[side].now = tack
  }

  function update(player: Boat, partner: Boat, wind: Wind, time: number) {
    track('player', player, wind, time)
    track('partner', partner, wind, time)
    const gap = distance(player.position, partner.position)
    if (!engaged) {
      if (gap > ENGAGE_DISTANCE) return
      engaged = true
    }
    const boats: Record<Side, Boat> = { player, partner }
    const row = rightOfWay(player, partner, wind)
    if (row && (!duty || duty.giveWay !== row.giveWay)) {
      const acquirer: Side = row.giveWay === 'player' ? 'partner' : 'player'
      const byTack = time - tacks[acquirer].changedAt <= TACK_GRACE
      duty = { giveWay: row.giveWay, since: time }
      lastClear = -1
      exhausted = false
      const tacked = byTack ? `${who(acquirer)}换舷取得优先，` : ''
      add('duty', `避让义务 · ${tacked}${who(row.giveWay)}让路（${row.basis}）`, time, mid(player.position, partner.position))
      if (byTack) {
        // 换舷取得优先：当场核验让路方是否还有无碰路线，结论保留到本次交会结束
        const routes = escapeRoutes(boats[row.giveWay], boats[acquirer], wind, course)
        acquisition = { by: acquirer, giveWay: row.giveWay, at: time, leftRoute: hasClearRoute(routes) }
      }
    }
    if (duty && !contacted && time - routeCheckAt >= ROUTE_CHECK_STEP) {
      routeCheckAt = time
      const keeper = duty.giveWay
      const routes = escapeRoutes(boats[keeper], boats[keeper === 'player' ? 'partner' : 'player'], wind, course)
      if (hasClearRoute(routes)) lastClear = time
      else if (!exhausted) {
        exhausted = true
        add('exhaust', `避让机会耗尽 · ${who(keeper)}只剩触礁/出界/相撞航线`, time, { ...boats[keeper].position })
      }
    }
    if (!contacted && gap <= CONTACT_DISTANCE) {
      contacted = true
      add('contact', '实际接触 · 与陪练艇相撞', time, mid(player.position, partner.position))
      judge(player, partner, wind, time)
    }
    if (gap > DISENGAGE_DISTANCE) close()
  }

  function judge(player: Boat, partner: Boat, wind: Wind, time: number) {
    const at = mid(player.position, partner.position)
    // 刚换舷取得优先却没留出无碰路线 → 换舷方全责（不受此后船位变化影响）
    if (acquisition && !acquisition.leftRoute) {
      add('verdict', `判定 · ${who(acquisition.by)}全责 · 换舷取得优先未留无碰路线`, time, at, acquisition.by === 'player' ? FAULT_PENALTY : 0)
      return
    }
    const row = rightOfWay(player, partner, wind)
    if (!duty || !row) {
      add('verdict', '判定 · 交会经过无法确定，留作争议', time, at)
      return
    }
    // 让路方曾拥有足够窗口的安全出口却未转舵 → 让路方全责
    if (lastClear >= duty.since + CLEAR_WINDOW) {
      add('verdict', `判定 · ${who(duty.giveWay)}全责 · 有安全出口未避让`, time, at, duty.giveWay === 'player' ? FAULT_PENALTY : 0)
      return
    }
    add('verdict', '判定 · 避让窗口过短，责任无法确定，留作争议', time, at)
  }

  return { update, reset }
}
