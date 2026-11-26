import { course } from '../src/features/chart/model/course'
import { usePartner } from '../src/features/sail/model/usePartner'
import { inspectWater } from '../src/features/chart/lib/geometry'
import { windAt } from '../src/features/wind/lib/forecast'

// 陪练艇沿赛道反向巡航 600 秒（两种风况），不应触礁、出界或失速。
for (const mode of ['steady', 'shifting'] as const) {
  const partner = usePartner(course)
  let minKnots = Infinity
  let contacts = 0
  const seen = new Set<string>()
  for (let t = 0; t <= 600; t += .1) {
    partner.step(windAt(t, mode), .1)
    const b = partner.boat.value
    if (t > 5) minKnots = Math.min(minKnots, b.knots)
    const water = inspectWater(course, b.position)
    if (water.length) {
      contacts++
      const key = water[0]
      if (seen.size < 8 && !seen.has(key)) {
        seen.add(key)
        console.log(`  ${mode} t=${t.toFixed(1)} (${b.position.x.toFixed(0)},${b.position.y.toFixed(0)}) h${b.heading.toFixed(0)} ${b.knots.toFixed(1)}kn -> ${water.join(',')}`)
      }
    }
  }
  const b = partner.boat.value
  console.log(`${mode}: 终点(${b.position.x.toFixed(0)},${b.position.y.toFixed(0)}) 最低速 ${minKnots.toFixed(1)}kn 触水次数 ${contacts}`)
  if (contacts > 0 || minKnots < .5) { console.log('✗ 陪练艇巡航异常'); process.exitCode = 1 }
}
console.log('陪练艇巡航正常')
