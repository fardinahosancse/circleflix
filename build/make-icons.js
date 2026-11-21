// Renders build/icon.svg to icon.png (512) and a multi-size icon.ico.
// Run: npx electron build/make-icons.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 400));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const big = full.resize({ width: 1024, height: 1024, quality: 'best' });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), big.resize({ width: 512, height: 512, quality: 'best' }).toPNG());

  // ICO container holding PNG-compressed images (supported since Windows Vista).
  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const pngs = sizes.map((s) => big.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(s >= 256 ? 0 : s, e); header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, ...pngs]));
  console.log('icons written');
  app.quit();
});
