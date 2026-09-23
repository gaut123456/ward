const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('data:text/html,<html></html>');
  const svg = fs.readFileSync(path.join(root, 'renderer/assets/app-icon.svg'), 'utf8');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await win.webContents.executeJavaScript(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};
    await image.decode();
    return ${JSON.stringify(sizes)}.map(size => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    });
  })()`);
  const pngs = images.map(value => Buffer.from(value, 'base64'));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const at = 6 + index * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(pngs[index].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += pngs[index].length;
  });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/icon.ico'), Buffer.concat([header, ...pngs]));
  fs.writeFileSync(path.join(root, 'renderer/assets/app-icon.png'), pngs.at(-1));
  console.log('Icon generated: seven sizes, 16–256 px.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
