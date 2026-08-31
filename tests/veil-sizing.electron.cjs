const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

// Exercise the actual shipped React/xterm renderer, isolated from user shells
// and config. No terminal private APIs or renderer replacements are used.
const packaged = resolve(__dirname, '../release/Veil Terminal.app/Contents/Resources/app');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'veil-sizing-')));
const sessions = new Map();
let serial = 0;
let closed = 0;
ipcMain.handle('config:get', () => ({}));
ipcMain.handle('terminal:create', async (_event, size) => {
  const id = `test-${++serial}`;
  sessions.set(id, { ...size });
  // Deliberately allow layout to change while the IPC creation is in flight.
  await new Promise(resolve => setTimeout(resolve, 80));
  return { id, cwd: '/tmp', shell: 'test' };
});
ipcMain.on('terminal:resize', (_event, { id, cols, rows }) => sessions.set(id, { cols, rows }));
ipcMain.on('terminal:close', (_event, id) => { sessions.delete(id); closed++; });
ipcMain.on('terminal:write', () => {});

let win;
const js = code => win.webContents.executeJavaScript(code);
const settle = async () => {
  // Wait for real paint turns, not a wall-clock guess (hidden test windows can
  // have a different frame cadence from the user's visible terminal).
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))');
  await new Promise(resolve => setTimeout(resolve, 150));
};
async function checkFit(label) {
  await settle();
  const layout = await js(`(() => {
    const workspace = document.querySelector('.tab-workspace.is-active');
    return {available:workspace.clientHeight, used:workspace.firstElementChild.getBoundingClientRect().height};
  })()`);
  assert.ok(Math.abs(layout.available-layout.used) <= 1, `${label}: pane uses only ${layout.used}px of ${layout.available}px workspace`);
  const panes = await js(`Array.from(document.querySelectorAll('.tab-workspace.is-active .terminal-pane')).map(pane => {
    const root = pane.querySelector('.xterm');
    const screen = pane.querySelector('.xterm-screen');
    const rows = pane.querySelector('.xterm-rows');
    const style = getComputedStyle(root);
    const available = pane.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return {available, height:screen.getBoundingClientRect().height,
      availableWidth:pane.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
      screenWidth:screen.getBoundingClientRect().width,
      rows:rows.children.length, rowHeight:rows.children[0].getBoundingClientRect().height};
  })`);
  assert.ok(panes.length > 0);
  for (const pane of panes) {
    console.log(label, JSON.stringify(pane));
    const gap = pane.available - pane.height;
    assert.ok(gap >= -1 && gap < pane.rowHeight + 1, `${label}: terminal leaves ${gap}px unused or clipped`);
    const widthGap = pane.availableWidth - pane.screenWidth;
    assert.ok(widthGap >= -1 && widthGap < pane.rowHeight + 16, `${label}: terminal width is clipped or stale`);
  }
  return panes;
}

async function checkTint(mode, color, opacity, rgb) {
  win.webContents.send('config:changed', {'glass-mode':mode, 'glass-color':color, 'glass-opacity':opacity});
  await settle();
  const actual = await js(`(() => {
    const surface = document.querySelector('.app-window');
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = getComputedStyle(surface).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  })()`);
  assert.ok(Math.abs(actual[3] - Math.round(opacity * 255)) <= 1, `${mode}: tint changed opacity (${actual})`);
  if (opacity > 0) rgb.forEach((value, channel) => {
    assert.ok(Math.abs(actual[channel] - value) <= 2, `${mode}: wrong tint (${actual})`);
  });
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ width:1120, height:720, show:false, backgroundColor:'#171a1e',
    webPreferences:{ preload:join(packaged, 'electron/preload.cjs'), backgroundThrottling:false } });
  try {
    await win.loadFile(join(packaged, 'dist/client/index.html'));
    await checkFit('startup');
    for (const mode of ['clear', 'liquid']) {
      await checkTint(mode, '#123456', 0.4, [18, 52, 86]);
      await checkTint(mode, '#aBc', 0.6, [170, 187, 204]);
      await checkTint(mode, '#14171c', 0.4, [20, 23, 28]);
      await checkTint(mode, undefined, 0.4, [20, 23, 28]);
      await checkTint(mode, 'invalid config color', 0.4, [20, 23, 28]);
      await checkTint(mode, '#ffffff', 0, [0, 0, 0]);
    }
    assert.equal(serial, 1, 'appearance changes must not recreate sessions');
    assert.equal(closed, 0);
    win.webContents.send('config:changed', {'font-family':'SFMono-Regular, SF Mono, Menlo, monospace', 'font-size':11, 'font-weight':400, 'line-height':1});
    const [small] = await checkFit('mac font without window resize');
    assert.equal(sessions.get('test-1').rows, small.rows, 'PTY must match renderer rows');
    win.webContents.send('terminal:data', {id:'test-1', data:Array.from({length:160}, (_,i)=>`row ${i+1}\r\n`).join('')+'BOTTOM-ROW-PROBE'});
    await settle();
    assert.ok(await js(`document.querySelector('.xterm-rows').lastElementChild.textContent.includes('BOTTOM-ROW-PROBE')`), 'long output must reach the last visible row');
    writeFileSync(join(tmpdir(), 'veil-sizing-preview.png'), (await win.webContents.capturePage()).toPNG());
    // Font/padding changes can happen in a hidden tab; activation must refit it.
    await js(`document.querySelector('.new-tab').click()`);
    await settle();
    win.webContents.send('config:changed', {'font-size':20, 'line-height':1.3, 'padding-y':28});
    await checkFit('large font and padding');
    await js(`document.querySelector('.tab').click()`);
    await checkFit('hidden tab reactivated');
    win.webContents.send('config:changed', {'font-size':11, 'line-height':1});
    await checkFit('small font restored');
    win.webContents.send('terminal:data', {id:'test-1', data:'split-buffer-marker\r\n'});
    await settle();
    await js(`document.querySelector('.tab-workspace.is-active .pane-leaf').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,clientX:150,clientY:150}));`);
    await settle();
    await js(`Array.from(document.querySelectorAll('.split-menu button')).find(b=>b.textContent==='Add tab above').click()`);
    const splitPanes = await checkFit('vertical split');
    assert.equal(splitPanes.length, 2);
    assert.equal(serial, 3, 'splitting must create only one additional shell');
    assert.equal(closed, 0, 'splitting must preserve existing sessions');
    await checkTint('liquid', '#123456', 0.4, [18, 52, 86]);
    assert.ok(await js(`Array.from(document.querySelectorAll('.pane-leaf, .terminal-pane, .xterm, .xterm-viewport')).every(el => {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = getComputedStyle(el).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3] === 0;
    })`), 'split backgrounds must stay transparent, without stacking tint');
    assert.ok(await js(`Array.from(document.querySelectorAll('.xterm-rows')).some(el=>el.textContent.includes('split-buffer-marker'))`), 'split must preserve existing text');
    win.setSize(950, 580);
    await checkFit('resized split');
    await js(`document.querySelector('.tab-workspace.is-active .pane-leaf').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,clientX:150,clientY:150}));`);
    await settle();
    await js(`Array.from(document.querySelectorAll('.split-menu button')).find(b=>b.textContent==='Close split').click()`);
    assert.equal((await checkFit('split closed back to full-height pane')).length, 1);
    await js(`document.querySelector('.tab-workspace.is-active .pane-leaf').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,clientX:150,clientY:150}));`);
    await settle();
    await js(`Array.from(document.querySelectorAll('.split-menu button')).find(b=>b.textContent==='Add tab right').click()`);
    assert.equal((await checkFit('horizontal split')).length, 2);
    console.log('PASS: live background colors, terminal geometry, font changes, tab activation and split preservation');
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  }
});
