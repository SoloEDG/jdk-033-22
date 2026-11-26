import { ref } from 'vue'
import { angleDelta, clamp, distance, normalize } from '../../../shared/math'
import type { Boat, Course, Point, Wind } from '../../../shared/race'
import { advanceBoat, preferredSheet } from '../lib/dynamics'

const headingTo = (from: Point, to: Point) => normalize(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI)

/**
 * 陪练艇：沿一条环绕赛道的平滑环路巡航，保持既定航线不主动避让，
 * 交会时的避让责任由裁判按练习规则认定。
 * 环路避开礁浅接触区（潮音礁南侧通道过窄，一律走北侧）。
 */
export function usePartner(course: Course) {
  const waypoints: Point[] = [
    { x: 700, y: 120 },
    { x: 830, y: 300 },
    { x: 720, y: 400 },
    { x: 460, y: 390 },
    { x: 300, y: 430 },
    { x: 220, y: 300 },
    { x: 320, y: 180 },
  ]
  const atAnchor = (): Boat => ({
    position: { ...waypoints[0] }, heading: headingTo(waypoints[0], waypoints[1]), knots: 7, sheet: 30, rudder: 0,
  })
  const boat = ref(atAnchor())
  let target = 1
  function reset() {
    boat.value = atAnchor()
    target = 1
  }
  function step(wind: Wind, seconds: number) {
    if (distance(boat.value.position, waypoints[target]) < 34) target = (target + 1) % waypoints.length
    const turn = angleDelta(boat.value.heading, headingTo(boat.value.position, waypoints[target]))
    boat.value = advanceBoat({
      ...boat.value,
      rudder: clamp(turn / 18, -1, 1),
      sheet: preferredSheet(boat.value.heading, wind),
    }, wind, seconds)
  }
  return { boat, reset, step }
}
