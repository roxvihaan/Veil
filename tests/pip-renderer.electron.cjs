const assert=require('node:assert/strict');
const {app,BrowserWindow,ipcMain}=require('electron');
const {mkdtempSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const packaged=resolve(__dirname,'../release/Veil Terminal.app/Contents/Resources/app');
const live=process.argv.includes('--live');
app.setPath('userData',mkdtempSync(join(tmpdir(),'veil-pip-test-')));
let serial=0,closed=0,win,panes=[],errors=[],drops=[],actions=[];
ipcMain.handle('config:get',()=>({}));
ipcMain.handle('terminal:create',()=>({id:'test-'+(++serial),shell:'test',cwd:'/tmp'}));
ipcMain.on('terminal:resize',()=>{});ipcMain.on('terminal:write',()=>{});ipcMain.on('terminal:close',()=>closed++);
ipcMain.on('pip:panes',(_e,p)=>{panes=p;if(live)console.log('Live PiP panes',JSON.stringify({contentBounds:win.getContentBounds(),panes:p}));});
ipcMain.on('pip:action',(_e,action)=>actions.push(action));
ipcMain.handle('terminal:image-drop',(_event,drop)=>{drops.push(drop);return {ok:true};});
const js=code=>win.webContents.executeJavaScript(code);
const settle=()=>new Promise(r=>setTimeout(r,250));
async function menu(selector,label){
  await js(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120}))`);await settle();
  await js(`Array.from(document.querySelectorAll('.split-menu button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);await settle();
}
app.whenReady().then(async()=>{
  win=new BrowserWindow({width:1120,height:720,show:false,backgroundColor:'#171a1e',webPreferences:{preload:join(packaged,'electron/preload.cjs'),backgroundThrottling:false}});
  if(live){require(join(packaged,'electron/pip-docking.cjs')).installPiP(win,ipcMain);win.setTitle('Veil PiP isolated preview');win.on('closed',()=>app.quit());}
  win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  try{
    await win.loadFile(join(packaged,'dist/client/index.html'));await settle();
    if(live){win.show();win.webContents.send('terminal:data',{id:'test-1',data:'\x1b]777;veil-pip\x07'});return;}
    win.webContents.send('terminal:data',{id:'test-1',data:'\x1b[?1049h\x1b[38;2;120;220;160mASCII-GIF-SESSION\r\n /\\_/\\\r\n( o.o )\r\n > ^ <'});await settle();
    await js('window.originalXterm=document.querySelector(".xterm")');
    await menu('.terminal-pane','Split right');
    win.webContents.send('terminal:data',{id:'test-2',data:'\x1b]777;veil-pip\x07'});await settle();
    assert.equal(serial,2,'connecting PiP must reuse the chosen split');
    assert.equal(closed,0,'connecting PiP must preserve its shell');
    assert.equal(await js('document.querySelectorAll(".pane-leaf").length'),2);
    await js('document.querySelector(".terminal-pane").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:100,clientY:150}))');await settle();
    assert.ok(await js('Array.from(document.querySelectorAll(".split-menu button")).every(b=>!/[Pp]i[Pp]|image|GIF/.test(b.textContent))'),'context menu must contain only split actions');
    await js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');await settle();
    assert.equal(panes.length,1);const id=panes[0].id;
    win.webContents.send('pip:event',{type:'preview',paneId:id,strength:.8});await settle();
    assert.equal(await js('document.querySelectorAll(".veil-pip-pane.is-ready").length'),1);
    writeFileSync(join(tmpdir(),'veil-pip-preview.png'),(await win.webContents.capturePage()).toPNG());
    win.webContents.send('pip:event',{type:'content',paneId:id,typeFrom:'empty',content:{type:'external-pip',windowId:'test-pip'}});await settle();
    assert.equal(panes[0].type,'external-pip');
    const before=panes[0].rect.width;
    win.webContents.send('pip:event',{type:'resize-pane',paneId:id,width:350,height:220});await settle();
    assert.ok(panes[0].rect.width<before);
    win.webContents.send('pip:event',{type:'content',paneId:id,typeFrom:'external-pip',content:{type:'empty'}});await settle();
    const file=resolve(__dirname,'../assets/veil.icns');
    const dropPoint=await js('(()=>{const r=document.querySelector(".veil-media-host").getBoundingClientRect();return {x:r.x+40,y:r.y+40}})()');
    win.webContents.debugger.attach('1.3');
    for(const type of ['dragEnter','dragOver','drop'])await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type,...dropPoint,data:{items:[],files:[file],dragOperationsMask:1}});
    win.webContents.debugger.detach();await settle();
    assert.deepEqual(drops,[{id:'test-1',file}],'native file drop must carry the correct path and target session');
    await js('document.querySelector(".veil-image-move").click()');await settle();
    assert.equal(await js('document.querySelectorAll(".veil-floating-media").length'),1);
    assert.ok(await js('window.originalXterm===document.querySelector(".veil-floating-media .xterm")'));
    assert.ok(await js('document.querySelector(".veil-floating-media").textContent.includes("ASCII-GIF-SESSION")'));
    // Resize and drag via real Chromium pointer events, not synthetic handlers.
    await js('document.querySelector(".veil-floating-media").style.width="300px";document.querySelector(".veil-floating-media").style.height="220px"');await settle();
    const grip=await js('(()=>{const r=document.querySelector(".veil-media-grip").getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+10)}})()');
    const dest=await js('(()=>{const r=document.querySelector(".veil-pip-pane").getBoundingClientRect();return {x:Math.round(r.x+30),y:Math.round(r.y+30)}})()');
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...grip});
    win.webContents.sendInputEvent({type:'mouseMove',...dest});await settle();
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...dest});await settle();
    assert.equal(await js('document.querySelectorAll(".veil-floating-media").length'),0,'drop should dock media');
    assert.ok(await js('window.originalXterm.isConnected'),'ASCII xterm must survive docking');
    assert.equal(serial,2);assert.equal(closed,0);
    await js('Array.from(document.querySelectorAll(".veil-pip-pane button")).find(b=>b.textContent==="Return to terminal").click()');await settle();
    assert.equal(serial,2);assert.equal(closed,0,'restoring a parked terminal must reuse its session');
    win.webContents.send('terminal:data',{id:'test-2',data:'\x1b]777;veil-pip;unbound\x07'});await settle();
    win.webContents.send('pip:event',{type:'windows',windows:[{id:'source:1',title:'Test PiP'}]});await settle();
    await js('Array.from(document.querySelectorAll(".veil-pip-pane button")).find(b=>b.textContent.startsWith("Test PiP")).click()');await settle();
    assert.equal(actions.at(-1).mode,'unbound','OSC mode must reach the native controller');
    await js('Array.from(document.querySelectorAll(".veil-pip-pane button")).find(b=>b.textContent==="Return to terminal").click()');await settle();
    assert.equal(serial,2);assert.equal(closed,0);
    await menu('.terminal-pane','Split below');
    assert.equal(serial,3);assert.equal(closed,0);
    win.setSize(900,580);await settle();
    assert.ok(await js('window.originalXterm.isConnected'));
    await js('window.dispatchEvent(new CustomEvent("veil:float-media",{detail:window.originalXterm.closest(".pane-leaf").dataset.paneId}))');await settle();
    assert.equal(await js('document.querySelectorAll(".veil-floating-media").length'),1);
    await js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');await settle();
    assert.equal(await js('document.querySelectorAll(".veil-floating-media").length'),0);
    assert.equal(closed,0);assert.deepEqual(errors,[]);
    console.log('PiP pane ownership, preview, resizing, ASCII drag/drop, nested splits and session retention passed.');
    win.destroy();app.exit(0);
  }catch(error){console.error(error);win.destroy();app.exit(1);}
});
