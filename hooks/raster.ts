// Software 2D canvas and PNG encoder.
// The hooks environment has no DOM, no canvas and no CompressionStream, so the
// office is painted into RGBA buffers here and shipped to the pane as PNG.
// Px implements only the subset of CanvasRenderingContext2D the office art uses:
// fillStyle (#rrggbb, rgba()), fillRect, globalAlpha, 'source-over' and
// 'lighter' compositing, translate/setTransform, save/restore, rect clips and
// drawImage of another Px. Coordinates are rounded to whole pixels.

type Comp = 'source-over' | 'lighter'
type Rgba = [number, number, number, number]

const colorCache = new Map<string, Rgba>()
export function parseColor(s: string): Rgba {
  let c = colorCache.get(s)
  if (c) return c
  if (s[0] === '#') {
    const hex = s.length === 4 ? s[1]! + s[1] + s[2]! + s[2] + s[3]! + s[3] : s.slice(1, 7)
    c = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1]
  } else {
    const m = /rgba?\(([^)]*)\)/.exec(s)
    const p = m ? m[1]!.split(',').map(Number) : [0, 0, 0, 1]
    c = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p.length > 3 ? (p[3] ?? 1) : 1]
  }
  colorCache.set(s, c)
  return c
}

type Saved = { tx: number; ty: number; clip: number[]; alpha: number; comp: Comp }

export class Px {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  readonly u32: Uint32Array
  /** Set on fully opaque layers so drawImage can copy rows. */
  opaque = false
  /** Per-row spans of non-transparent pixels, built once by freeze(). */
  spans: Int32Array[] | null = null
  /** Per row, [start, end) runs of fully opaque pixels (copied as blocks by drawImage). */
  solid: Int32Array[] | null = null
  globalAlpha = 1
  globalCompositeOperation: Comp = 'source-over'
  imageSmoothingEnabled = false
  private tx = 0
  private ty = 0
  private clipBox: number[]
  private pathRect: number[] | null = null
  private stack: Saved[] = []
  private fs = '#000000'
  private fr = 0
  private fg = 0
  private fb = 0
  private fa = 1

  constructor(w: number, h: number) {
    this.width = w
    this.height = h
    this.data = new Uint8ClampedArray(w * h * 4)
    this.u32 = new Uint32Array(this.data.buffer)
    this.clipBox = [0, 0, w, h]
  }
  getContext(): Px { return this }
  set fillStyle(v: string) {
    if (v === this.fs) return
    this.fs = v
    const c = parseColor(v)
    this.fr = c[0]; this.fg = c[1]; this.fb = c[2]; this.fa = c[3]
  }
  get fillStyle(): string { return this.fs }
  save(): void { this.stack.push({ tx: this.tx, ty: this.ty, clip: this.clipBox.slice(), alpha: this.globalAlpha, comp: this.globalCompositeOperation }) }
  restore(): void {
    const s = this.stack.pop()
    if (!s) return
    this.tx = s.tx; this.ty = s.ty; this.clipBox = s.clip; this.globalAlpha = s.alpha; this.globalCompositeOperation = s.comp
  }
  translate(x: number, y: number): void { this.tx += x; this.ty += y }
  setTransform(_a: number, _b: number, _c: number, _d: number, e: number, f: number): void { this.tx = e; this.ty = f }
  beginPath(): void { this.pathRect = null }
  rect(x: number, y: number, w: number, h: number): void { this.pathRect = [Math.round(x + this.tx), Math.round(y + this.ty), Math.round(x + this.tx + w), Math.round(y + this.ty + h)] }
  clip(): void {
    const p = this.pathRect
    if (!p) return
    const c = this.clipBox
    this.clipBox = [Math.max(c[0]!, p[0]!), Math.max(c[1]!, p[1]!), Math.min(c[2]!, p[2]!), Math.min(c[3]!, p[3]!)]
  }
  clear(): void { this.data.fill(0) }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (w < 0) { x += w; w = -w }
    if (h < 0) { y += h; h = -h }
    const c = this.clipBox
    let x0 = Math.round(x + this.tx), y0 = Math.round(y + this.ty)
    let x1 = Math.round(x + this.tx + w), y1 = Math.round(y + this.ty + h)
    if (x0 < c[0]!) x0 = c[0]!
    if (y0 < c[1]!) y0 = c[1]!
    if (x1 > c[2]!) x1 = c[2]!
    if (y1 > c[3]!) y1 = c[3]!
    if (x0 >= x1 || y0 >= y1) return
    const sa = this.fa * this.globalAlpha
    if (sa <= 0) return
    const W = this.width, d = this.data, R = this.fr, G = this.fg, B = this.fb
    if (this.globalCompositeOperation === 'lighter') {
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * W + x0) * 4
        for (let xx = x0; xx < x1; xx++, i += 4) {
          const da = d[i + 3]! / 255
          const oa = Math.min(1, sa + da)
          if (oa <= 0) continue
          d[i] = (R * sa + d[i]! * da) / oa
          d[i + 1] = (G * sa + d[i + 1]! * da) / oa
          d[i + 2] = (B * sa + d[i + 2]! * da) / oa
          d[i + 3] = oa * 255
        }
      }
      return
    }
    if (sa >= 1) {
      const v = (255 << 24 | B << 16 | G << 8 | R) >>> 0
      const u = this.u32
      for (let yy = y0; yy < y1; yy++) u.fill(v, yy * W + x0, yy * W + x1)
      return
    }
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * W + x0) * 4
      for (let xx = x0; xx < x1; xx++, i += 4) blend(d, i, R, G, B, sa)
    }
  }

  /** Records the non-transparent spans of each row (for layers drawn every frame). */
  freeze(): this {
    const W = this.width, d = this.data, rows: Int32Array[] = []
    let opaque = true
    for (let y = 0; y < this.height; y++) {
      const list: number[] = []
      let start = -1
      for (let x = 0; x <= W; x++) {
        const a = x < W ? d[(y * W + x) * 4 + 3]! : 0
        if (a < 255) opaque = false
        if (a > 0 && start < 0) start = x
        else if (a === 0 && start >= 0) { list.push(start, x); start = -1 }
      }
      rows.push(Int32Array.from(list))
    }
    const solid: Int32Array[] = []
    for (let y = 0; y < this.height; y++) {
      const list: number[] = []
      let start = -1
      for (let x = 0; x <= W; x++) {
        const full = x < W && d[(y * W + x) * 4 + 3]! === 255
        if (full && start < 0) start = x
        else if (!full && start >= 0) { list.push(start, x); start = -1 }
      }
      solid.push(Int32Array.from(list))
    }
    this.solid = solid
    this.spans = rows
    this.opaque = opaque
    return this
  }

  /** Composites another Px at (dx, dy) under the current transform and clip. */
  drawImage(src: Px, dx = 0, dy = 0): void {
    const c = this.clipBox
    const ox = Math.round(dx + this.tx), oy = Math.round(dy + this.ty)
    const x0 = Math.max(c[0]!, ox), y0 = Math.max(c[1]!, oy)
    const x1 = Math.min(c[2]!, ox + src.width), y1 = Math.min(c[3]!, oy + src.height)
    if (x0 >= x1 || y0 >= y1) return
    const W = this.width, SW = src.width, d = this.data, s = src.data, ga = this.globalAlpha
    if (src.opaque && ga >= 1 && this.globalCompositeOperation === 'source-over') {
      for (let y = y0; y < y1; y++) {
        const so = (y - oy) * SW + (x0 - ox)
        this.u32.set(src.u32.subarray(so, so + (x1 - x0)), y * W + x0)
      }
      return
    }
    // Pixel art is mostly fully opaque: copy those pixels as they are (what a
    // blend at alpha 1 gives) and blend only the partly transparent ones.
    const plain = ga >= 1 && this.globalCompositeOperation === 'source-over', su = src.u32, du = this.u32
    if (plain && src.solid && src.spans) {
      for (let y = y0; y < y1; y++) {
        const sy = y - oy, row = sy * SW, sol = src.solid[sy]!, sp = src.spans[sy]!
        // whole runs of opaque pixels: block copies
        for (let k = 0; k < sol.length; k += 2) {
          const a0 = Math.max(x0, sol[k]! + ox), a1 = Math.min(x1, sol[k + 1]! + ox)
          if (a0 < a1) du.set(su.subarray(row + a0 - ox, row + a1 - ox), y * W + a0)
        }
        // the partly transparent pixels in between: blended one by one
        for (let k = 0; k < sp.length; k += 2) {
          const a0 = Math.max(x0, sp[k]! + ox), a1 = Math.min(x1, sp[k + 1]! + ox)
          for (let x = a0; x < a1; x++) {
            const a = su[row + x - ox]! >>> 24
            if (a === 255 || !a) continue
            const si = (row + x - ox) * 4
            blend(d, (y * W + x) * 4, s[si]!, s[si + 1]!, s[si + 2]!, s[si + 3]! / 255)
          }
        }
      }
      return
    }
    for (let y = y0; y < y1; y++) {
      const sy = y - oy
      const sp = src.spans ? src.spans[sy]! : Int32Array.of(0, SW)
      for (let k = 0; k < sp.length; k += 2) {
        const a0 = Math.max(x0, sp[k]! + ox), a1 = Math.min(x1, sp[k + 1]! + ox)
        for (let x = a0; x < a1; x++) {
          const sj = sy * SW + (x - ox)
          if (plain) {
            const v = su[sj]!, a = v >>> 24
            if (a === 255) { du[y * W + x] = v; continue }
            if (!a) continue
          }
          const si = sj * 4, sa = s[si + 3]! / 255 * ga
          if (sa > 0) blend(d, (y * W + x) * 4, s[si]!, s[si + 1]!, s[si + 2]!, sa)
        }
      }
    }
  }

  /** Blends a constant colour by a per-pixel alpha map (the room lighting). */
  /** Lights the canvas from an alpha map; with x0/x1, only those columns (one slot of a pinned view). */
  shade(alpha: Uint8Array, mapW: number, mapX: number, r: number, g: number, b: number, x0 = 0, x1 = this.width): void {
    const W = this.width, H = this.height, d = this.data
    for (let y = 0; y < H; y++) {
      let i = (y * W + x0) * 4, m = y * mapW + mapX + x0
      for (let x = x0; x < x1; x++, i += 4, m++) {
        const a = alpha[m]!
        if (!a) continue
        const t = a / 255
        d[i] = d[i]! + (r - d[i]!) * t
        d[i + 1] = d[i + 1]! + (g - d[i + 1]!) * t
        d[i + 2] = d[i + 2]! + (b - d[i + 2]!) * t
      }
    }
  }
}

function blend(d: Uint8ClampedArray, i: number, R: number, G: number, B: number, sa: number): void {
  const da = d[i + 3]! / 255
  if (da >= 1) {
    d[i] = R * sa + d[i]! * (1 - sa)
    d[i + 1] = G * sa + d[i + 1]! * (1 - sa)
    d[i + 2] = B * sa + d[i + 2]! * (1 - sa)
    return
  }
  const oa = sa + da * (1 - sa)
  if (oa <= 0) return
  const k = da * (1 - sa)
  d[i] = (R * sa + d[i]! * k) / oa
  d[i + 1] = (G * sa + d[i + 1]! * k) / oa
  d[i + 2] = (B * sa + d[i + 2]! * k) / oa
  d[i + 3] = oa * 255
}

// ================= deflate (LZ77 + one dynamic Huffman block) =================

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
const LEN_CODE = new Uint16Array(259)
const DIST_CODE = new Uint8Array(32769)
for (let c = 0; c < 29; c++) {
  const end = c === 28 ? 259 : LEN_BASE[c + 1]!
  for (let l = LEN_BASE[c]!; l < end; l++) LEN_CODE[l] = c
}
LEN_CODE[258] = 28
for (let c = 0; c < 30; c++) {
  const end = c === 29 ? 32769 : DIST_BASE[c + 1]!
  for (let dd = DIST_BASE[c]!; dd < end; dd++) DIST_CODE[dd] = c
}

const WSIZE = 32768, WMASK = WSIZE - 1, HBITS = 15, HSIZE = 1 << HBITS, HMASK = HSIZE - 1
// Tuned on office frames: chain 8, greedy matching, no PNG filter gave both
// the smallest frames (~12 KB at 240x176) and ~4 ms per encode.
const MAX_CHAIN = 8, NICE = 64

class Bits {
  buf: Uint8Array
  pos = 0
  bb = 0
  bc = 0
  constructor(n: number) { this.buf = new Uint8Array(n) }
  put(v: number, n: number): void {
    this.bb |= v << this.bc
    this.bc += n
    while (this.bc >= 8) {
      if (this.pos >= this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb }
      this.buf[this.pos++] = this.bb & 255
      this.bb >>>= 8
      this.bc -= 8
    }
  }
  flush(): Uint8Array {
    if (this.bc > 0) this.put(0, 8 - this.bc)
    return this.buf.subarray(0, this.pos)
  }
}

/** Huffman code lengths for `freq`, no longer than `limit`. */
function codeLengths(freq: Uint32Array, limit: number): Uint8Array {
  const n = freq.length, out = new Uint8Array(n)
  let f = Array.from(freq)
  for (;;) {
    const live: number[] = []
    for (let i = 0; i < n; i++) if (f[i]! > 0) live.push(i)
    if (live.length === 0) return out
    if (live.length === 1) { out[live[0]!] = 1; out[live[0] === 0 ? 1 : 0] = 1; return out }
    // Heap-free Huffman: two sorted queues (leaves, then merged nodes).
    const leaves = live.slice().sort((a, b) => f[a]! - f[b]! || a - b)
    const weight: number[] = [], parent: number[] = []
    for (const s of leaves) { weight.push(f[s]!); parent.push(-1) }
    const L = leaves.length
    let li = 0, ni = L
    const pick = (): number => {
      if (li < L && (ni >= weight.length || weight[li]! <= weight[ni]!)) return li++
      return ni++
    }
    while (weight.length < 2 * L - 1) {
      const a = pick(), b = pick()
      weight.push(weight[a]! + weight[b]!)
      parent.push(-1)
      parent[a] = weight.length - 1
      parent[b] = weight.length - 1
    }
    const depth = new Array<number>(weight.length).fill(0)
    for (let i = weight.length - 2; i >= 0; i--) depth[i] = depth[parent[i]!]! + 1
    let max = 0
    for (let i = 0; i < L; i++) max = Math.max(max, depth[i]!)
    if (max <= limit) {
      for (let i = 0; i < L; i++) out[leaves[i]!] = depth[i]!
      return out
    }
    f = f.map(v => (v > 0 ? Math.max(1, v >> 1) : 0))
  }
}

/** Canonical codes, bit-reversed for LSB-first output. */
function canonical(len: Uint8Array): Uint16Array {
  const count = new Uint16Array(16), next = new Uint16Array(16), codes = new Uint16Array(len.length)
  for (const l of len) if (l) count[l]!++
  let code = 0
  for (let b = 1; b < 16; b++) { code = (code + count[b - 1]!) << 1; next[b] = code }
  for (let i = 0; i < len.length; i++) {
    const l = len[i]!
    if (!l) continue
    let c = next[l]!++, r = 0
    for (let k = 0; k < l; k++) { r = (r << 1) | (c & 1); c >>= 1 }
    codes[i] = r
  }
  return codes
}

let headBuf = new Int32Array(HSIZE), prevBuf = new Int32Array(WSIZE)
let symBuf = new Uint32Array(1 << 16)

export function deflate(data: Uint8Array): Uint8Array {
  const n = data.length
  const head = headBuf.fill(-1), prev = prevBuf
  if (symBuf.length < n + 8) symBuf = new Uint32Array(n + 8)
  const syms = symBuf
  let ns = 0
  const lf = new Uint32Array(286), df = new Uint32Array(30)
  const hashAt = (i: number): number => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & HMASK
  const insert = (i: number): void => {
    if (i + 2 >= n) return
    const h = hashAt(i)
    prev[i & WMASK] = head[h]!
    head[h] = i
  }
  const longest = (i: number): number => {
    if (i + 2 >= n) return 0
    let cand = head[hashAt(i)]!, best = 0, bestD = 0, chain = MAX_CHAIN
    const maxLen = Math.min(258, n - i)
    while (cand >= 0 && i - cand <= WSIZE && chain-- > 0) {
      if (data[cand + best] === data[i + best]) {
        let l = 0
        while (l < maxLen && data[cand + l] === data[i + l]) l++
        if (l > best) { best = l; bestD = i - cand; if (l >= NICE) break }
      }
      const p = prev[cand & WMASK]!
      if (p >= cand) break
      cand = p
    }
    return best >= 3 ? (best << 16) | bestD : 0
  }
  let i = 0
  while (i < n) {
    const m = longest(i)
    if (m) {
      const len = m >>> 16, dist = m & 0xffff
      syms[ns++] = (len << 16) | dist | 0x80000000
      lf[257 + LEN_CODE[len]!]!++
      df[DIST_CODE[dist]!]!++
      for (let k = 0; k < len; k++) insert(i + k)
      i += len
    } else {
      insert(i)
      syms[ns++] = data[i]!
      lf[data[i]!]!++
      i++
    }
  }
  lf[256] = 1
  let dsum = 0
  for (const v of df) dsum += v
  if (dsum === 0) df[0] = 1
  const ll = codeLengths(lf, 15), dl = codeLengths(df, 15)
  let hlit = 286
  while (hlit > 257 && !ll[hlit - 1]) hlit--
  let hdist = 30
  while (hdist > 1 && !dl[hdist - 1]) hdist--
  // Run-length encode the code lengths (symbols 16, 17, 18).
  const all = [...ll.subarray(0, hlit), ...dl.subarray(0, hdist)]
  const rle: number[] = [], cf = new Uint32Array(19)
  for (let p = 0; p < all.length;) {
    const v = all[p]!
    let r = 1
    while (p + r < all.length && all[p + r] === v) r++
    if (v === 0 && r >= 3) {
      const t = Math.min(r, 138)
      if (t >= 11) { rle.push(18, t - 11); cf[18]!++ } else { rle.push(17, t - 3); cf[17]!++ }
      p += t
    } else if (v !== 0 && r >= 4) {
      rle.push(v, -1); cf[v]!++
      const t = Math.min(r - 1, 6)
      rle.push(16, t - 3); cf[16]!++
      p += t + 1
    } else {
      rle.push(v, -1); cf[v]!++
      p++
    }
  }
  const cl = codeLengths(cf, 7), cc = canonical(cl)
  let hclen = 19
  while (hclen > 4 && !cl[CL_ORDER[hclen - 1]!]) hclen--
  const lc = canonical(ll), dc = canonical(dl)
  const out = new Bits(Math.max(1024, n >> 2))
  out.put(1, 1) // final block
  out.put(2, 2) // dynamic Huffman
  out.put(hlit - 257, 5)
  out.put(hdist - 1, 5)
  out.put(hclen - 4, 4)
  for (let k = 0; k < hclen; k++) out.put(cl[CL_ORDER[k]!]!, 3)
  for (let k = 0; k < rle.length; k += 2) {
    const s = rle[k]!, x = rle[k + 1]!
    out.put(cc[s]!, cl[s]!)
    if (s === 16) out.put(x, 2)
    else if (s === 17) out.put(x, 3)
    else if (s === 18) out.put(x, 7)
  }
  for (let k = 0; k < ns; k++) {
    const s = syms[k]!
    if (s & 0x80000000) {
      const len = (s >>> 16) & 0x7fff, dist = s & 0xffff
      const lcI = LEN_CODE[len]!, dcI = DIST_CODE[dist]!
      out.put(lc[257 + lcI]!, ll[257 + lcI]!)
      if (LEN_EXTRA[lcI]) out.put(len - LEN_BASE[lcI]!, LEN_EXTRA[lcI]!)
      out.put(dc[dcI]!, dl[dcI]!)
      if (DIST_EXTRA[dcI]) out.put(dist - DIST_BASE[dcI]!, DIST_EXTRA[dcI]!)
    } else {
      out.put(lc[s]!, ll[s]!)
    }
  }
  out.put(lc[256]!, ll[256]!)
  // A rare huge input (a tall film atlas) must not pin its buffer for good.
  if (symBuf.length > 1 << 22) symBuf = new Uint32Array(1 << 16)
  return out.flush()
}

// ================= PNG =================

const CRC = new Uint32Array(256)
for (let k = 0; k < 256; k++) {
  let c = k
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC[k] = c >>> 0
}
function crc32(b: Uint8Array, s: number, e: number): number {
  let c = 0xffffffff
  for (let k = s; k < e; k++) c = CRC[(c ^ b[k]!) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function adler32(b: Uint8Array): number {
  let a = 1, d = 0
  for (let k = 0; k < b.length;) {
    const end = Math.min(b.length, k + 5552)
    for (; k < end; k++) { a += b[k]!; d += a }
    a %= 65521; d %= 65521
  }
  return ((d << 16) | a) >>> 0
}

let rawBuf = new Uint8Array(1 << 16)

/** Encodes RGBA pixels as PNG; `alpha` false writes RGB (opaque frames). */
export function encodePNG(px: Uint8ClampedArray | Uint8Array, w: number, h: number, alpha: boolean): Uint8Array {
  const bpp = alpha ? 4 : 3, stride = w * bpp, need = (stride + 1) * h
  if (rawBuf.length < need) rawBuf = new Uint8Array(need)
  const raw = rawBuf
  // Filter type 0 on every row: for flat pixel art it beats the adaptive
  // filters on size and costs nothing.
  for (let y = 0; y < h; y++) {
    let o = y * (stride + 1)
    raw[o++] = 0
    for (let x = 0, s = y * w * 4; x < w; x++, s += 4) {
      raw[o++] = px[s]!; raw[o++] = px[s + 1]!; raw[o++] = px[s + 2]!
      if (alpha) raw[o++] = px[s + 3]!
    }
  }
  const body = raw.subarray(0, need)
  const z = deflate(body)
  const zlen = z.length + 6
  const out = new Uint8Array(8 + 25 + 12 + zlen + 12)
  const dv = new DataView(out.buffer)
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  let p = 8
  const chunk = (type: string, len: number, fill: (at: number) => void): void => {
    dv.setUint32(p, len)
    for (let k = 0; k < 4; k++) out[p + 4 + k] = type.charCodeAt(k)
    fill(p + 8)
    dv.setUint32(p + 8 + len, crc32(out, p + 4, p + 8 + len))
    p += 12 + len
  }
  chunk('IHDR', 13, at => {
    dv.setUint32(at, w); dv.setUint32(at + 4, h)
    out[at + 8] = 8; out[at + 9] = alpha ? 6 : 2; out[at + 10] = 0; out[at + 11] = 0; out[at + 12] = 0
  })
  chunk('IDAT', zlen, at => {
    out[at] = 0x78; out[at + 1] = 0x01
    out.set(z, at + 2)
    dv.setUint32(at + 2 + z.length, adler32(body))
  })
  chunk('IEND', 0, () => {})
  if (rawBuf.length > 1 << 22) rawBuf = new Uint8Array(1 << 16)
  return out.subarray(0, p)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function base64(b: Uint8Array): string {
  const native = (b as unknown as { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(b)
  let s = ''
  let k = 0
  for (; k + 2 < b.length; k += 3) {
    const v = (b[k]! << 16) | (b[k + 1]! << 8) | b[k + 2]!
    s += B64[v >> 18]! + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63]
  }
  if (k < b.length) {
    const v = (b[k]! << 16) | ((b[k + 1] ?? 0) << 8)
    s += B64[v >> 18]! + B64[(v >> 12) & 63] + (k + 1 < b.length ? B64[(v >> 6) & 63] : '=') + '='
  }
  return s
}
