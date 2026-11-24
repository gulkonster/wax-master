// Renders build/icon.svg (master) and build/icon-small.svg (small form) into
// build/icon.ico and build/icon.png, and writes check pictures into
// studio/logo/e46/. Every size is drawn at 8 times its size and reduced by
// averaging 8x8 blocks (not resized from a larger icon).
// Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')


const ROOT = join(__dirname, '..')
const SCALE = 8
const SMALL_SIZES = [16, 20, 24]
const MASTER_SIZES = [32, 40, 48, 64, 128, 256]
const CHECK_SIZES = [16, 20, 24, 32, 48, 64, 256]
const BACKGROUNDS = { dark: '#1C1C1C', light: '#F3F3F3' }

function packIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

// Averages SCALE x SCALE blocks of a BGRA bitmap, weighting colour by alpha.
function reduce(bitmap, big, size) {
  const out = Buffer.alloc(size * size * 4)
  const n = SCALE * SCALE
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let b = 0, g = 0, r = 0, a = 0
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const i = ((y * SCALE + dy) * big + x * SCALE + dx) * 4
          const al = bitmap[i + 3]
          b += bitmap[i] * al
          g += bitmap[i + 1] * al
          r += bitmap[i + 2] * al
          a += al
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(b / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(r / a)
      }
      out[o + 3] = Math.round(a / n)
    }
  }
  return nativeImage.createFromBitmap(out, { width: size, height: size })
}

let win = null

async function render(svg, size, background) {
  const big = size * SCALE
  if (!win) win = new BrowserWindow({ width: big, height: big, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  win.setContentSize(big, big)
  const html = `<html><body style="margin:0;overflow:hidden;background:${background || 'transparent'}">${svg.replace('<svg ', `<svg width="${big}" height="${big}" `)}</body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 250))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: big, height: big })
  const got = image.getSize()
  if (got.width !== big || got.height !== big) throw new Error(`Captured ${got.width}x${got.height}, expected ${big}x${big}`)
  return reduce(image.toBitmap(), big, size)
}

app.whenReady().then(async () => {
  const master = readFileSync(join(ROOT, 'build', 'icon.svg'), 'utf8')
  const small = readFileSync(join(ROOT, 'build', 'icon-small.svg'), 'utf8')
  const pngs = []
  for (const size of SMALL_SIZES) pngs.push({ size, data: (await render(small, size)).toPNG() })
  for (const size of MASTER_SIZES) pngs.push({ size, data: (await render(master, size)).toPNG() })
  writeFileSync(join(ROOT, 'build', 'icon.ico'), packIco(pngs))
  writeFileSync(join(ROOT, 'build', 'icon.png'), (await render(master, 512)).toPNG())

  const dir = join(ROOT, 'studio', 'logo', 'e46')
  mkdirSync(dir, { recursive: true })
  for (const [form, svg] of [['master', master], ['small', small]]) {
    for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
      for (const size of CHECK_SIZES) {
        writeFileSync(join(dir, `${form}-${size}-${bgName}.png`), (await render(svg, size, bg)).toPNG())
      }
    }
  }
  app.quit()
})
