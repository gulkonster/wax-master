// Renders build/icon.svg into the PNG sizes Windows needs and packs them into
// build/icon.ico. Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

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

app.whenReady().then(async () => {
  const svg = readFileSync(join(__dirname, '..', 'build', 'icon.svg'), 'utf8')
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })
  const pngs = SIZES.map((size) => ({ size, data: image.resize({ width: size, height: size, quality: 'best' }).toPNG() }))
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), image.resize({ width: 256, height: 256 }).toPNG())
  writeFileSync(join(__dirname, '..', 'build', 'icon.ico'), packIco(pngs))
  app.quit()
})
