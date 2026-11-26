import { angleDelta, axis, distance, dot } from '../../../shared/math'
import type { Boat, Course, Wind } from '../../../shared/race'
import { inspectWater } from '../../chart/lib/geometry'
import { advanceBoat } from '../../sail/lib/dynamics'

export type Tack = 'port' | 'starboard'
export type Side = 'player' | 'partner'

/** 舷别：风从哪一舷吹来。正顶风或正顺风时舷别无法判定，返回 null。 */
export function tackOf(boat: Boat, wind: Wind): Tack | null {
  const from = angleDelta(boat.heading, wind.bearing)
  if (Math.abs(from) < 14 || Math.abs(from) > 166) return null
  return from < 0 ? 'port' : 'starboard'
}

export interface RightOfWay { giveWay: Side; basis: string }

/**
 * 相遇两船的避让义务：异舷时左舷受风的一方让路，同舷时上风艇让路。
 * 任一船舷别无法判定时返回 null（留作争议的依据）。
 */
export function rightOfWay(player: Boat, partner: Boat, wind: Wind): RightOfWay | null {
  const a = tackOf(player, wind)
  const b = tackOf(partner, wind)
  if (!a || !b) return null
  if (a !== b) return { giveWay: a === 'port' ? 'player' : 'partner', basis: '异舷·左舷受风' }
  const upwind = axis(wind.bearing)
  const playerWindward = dot(player.position, upwind) >= dot(partner.position, upwind)
  return { giveWay: playerWindward ? 'player' : 'partner', basis: '同舷·上风艇' }
}

/** 两船艇体接触距离（艇身约 36 单位长）。 */
export const CONTACT_DISTANCE = 24

export interface RouteOutcome { rudder: -1 | 0 | 1; clear: boolean; threat: string | null }

/**
 * 让路方凭当时舵、帆和速度能走通的路线集合：满舵左 / 回中 / 满舵右三种操舵，
 * 帆角与航速按当时状态自然演变，优先方假定保向保速。
 * 推演窗口取一次交会从形成到消解的时长；窗口内触礁、出界、撞标或与对手相撞，
 * 都算作该路线不通。
 */
export function escapeRoutes(boat: Boat, other: Boat, wind: Wind, course: Course, horizon = 5): RouteOutcome[] {
  const outcomes: RouteOutcome[] = []
  for (const rudder of [-1, 0, 1] as const) {
    let self: Boat = { ...boat, rudder }
    let rival: Boat = { ...other, rudder: 0 }
    let threat: string | null = null
    for (let t = 0; t < horizon && !threat; t += .15) {
      self = advanceBoat(self, wind, .15)
      rival = advanceBoat(rival, wind, .15)
      const water = inspectWater(course, self.position)
      if (water.length) threat = `将触${water[0]}`
      else if (distance(self.position, rival.position) <= CONTACT_DISTANCE) threat = '将与对手相撞'
    }
    outcomes.push({ rudder, clear: !threat, threat })
  }
  return outcomes
}

export const hasClearRoute = (routes: RouteOutcome[]) => routes.some(route => route.clear)
