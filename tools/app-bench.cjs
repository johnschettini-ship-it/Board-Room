// Replays a busy minute of office pictures in Chromium, as the app would draw
// them (inline Svg, replaced at each shot), and measures the browser's CPU.
// Usage: npx tsx tools/fluid-harness.ts shipped=1 zoom=2 pins=3 stacked=1 dump=/tmp/m.json
//        node tools/app-bench.cjs /tmp/m.json 593 60   (needs Playwright with Chromium)
const { chromium } = require('playwright')
const fs = require('fs')

const [dumpPath, widthArg, secArg] = process.argv.slice(2)
const shots = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const width = +widthArg
const seconds = +(secArg || 60)

function sized(svg) {
  const m = /^<svg [^>]*?width="(\d+)" height="(\d+)"/.exec(svg)
  if (!m) return svg
  const h = Math.round((width * +m[2]) / +m[1])
  return svg.replace(/width="\d+" height="\d+"/, `width="${width}" height="${h}"`)
}

function cpuTicks(rootPid) {
  // the browser and every process under it
  const procs = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d)).map(pid => {
    try {
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      const rest = st.slice(st.lastIndexOf(')') + 2).split(' ')
      return { pid: +pid, ppid: +rest[1], ticks: +rest[11] + +rest[12] }
    } catch { return null }
  }).filter(Boolean)
  const kids = new Map()
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p) }
  let sum = 0
  const walk = pid => { for (const c of kids.get(pid) || []) { sum += c.ticks; walk(c.pid) } }
  const root = procs.find(p => p.pid === rootPid)
  if (root) sum += root.ticks
  walk(rootPid)
  return sum
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 }, deviceScaleFactor: 1.5 })
  const page = await ctx.newPage()
  await page.setContent('<html><body style="margin:0;background:#111"><div id="v"></div></body></html>')
  const t0 = shots[0].t
  const list = shots.filter(s => s.t - t0 <= seconds).map(s => ({ t: s.t - t0, svg: sized(s.svg) }))
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  const pid = browser.process ? browser.process().pid : null
  const rootPid = pid || +require('child_process').execSync("pgrep -o -f 'chrom.*--headless'").toString().trim()
  const hz = 100
  const before = cpuTicks(rootPid)
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const result = await page.evaluate(async ({ list, seconds }) => {
    const v = document.getElementById('v')
    const gaps = []
    let last = performance.now(), run = true
    const tick = now => { gaps.push(now - last); last = now; if (run) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const start = performance.now()
    for (const s of list) {
      const wait = start + s.t * 1000 - performance.now()
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      v.innerHTML = s.svg
    }
    const rest = start + seconds * 1000 - performance.now()
    if (rest > 0) await new Promise(r => setTimeout(r, rest))
    run = false
    const long = gaps.filter(g => g > 50).length, worst = Math.max(...gaps)
    return { frames: gaps.length, long, worstMs: Math.round(worst) }
  }, { list, seconds })
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const after = cpuTicks(rootPid)
  const cpuPct = ((after - before) / hz) / seconds * 100
  console.log(JSON.stringify({
    dump: dumpPath.split('/').pop(), width, shots: list.length,
    browserCpuPctOfCore: +cpuPct.toFixed(1),
    mainThreadMsPerS: Math.round(((m1.TaskDuration - m0.TaskDuration) * 1000) / seconds),
    layoutMsPerS: Math.round(((m1.LayoutDuration - m0.LayoutDuration) * 1000) / seconds),
    styleMsPerS: Math.round(((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / seconds),
    ...result,
  }))
  await browser.close()
})()
