const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolve}=require('node:path');
const {mkdtempSync,copyFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {spawnSync}=require('node:child_process');
const {imageDrop,trackInput}=require('../electron/image-drop.cjs');
const image=resolve(__dirname,'../assets/veil.icns');
function entry(){const writes=[];return {writes,shellPath:'/bin/zsh',inputLength:0,inputUnknown:false,terminal:{process:'zsh',write:s=>writes.push(s)}};}
test('file drop runs veil image once at an empty prompt',()=>{
  const e=entry();assert.equal(imageDrop(e,image).ok,true);assert.equal(e.writes[0],`veil image '${image}'\r`);
  assert.equal(imageDrop(e,image).ok,false,'duplicate drops cannot race');
});
test('file drops never append to existing input or running programs',()=>{
  const e=entry();trackInput(e,'echo hello');assert.equal(imageDrop(e,image).ok,false);
  trackInput(e,'\x03');e.terminal.process='vim';assert.equal(imageDrop(e,image).ok,false);
  e.terminal.process='zsh';trackInput(e,'\x1b[A');assert.equal(imageDrop(e,image).ok,false);
  trackInput(e,'\r');assert.equal(imageDrop(e,image).ok,true);
});
test('ordinary deletion restores an empty prompt; unsupported drops do nothing',()=>{
  const e=entry();trackInput(e,'abc\x7f\x7f\x7f');assert.equal(imageDrop(e,image).ok,true);
  assert.equal(imageDrop(entry(),resolve(__dirname,'image-drop.test.cjs')).ok,false);
  assert.equal(imageDrop(entry(),'/missing/image.png').ok,false);
});
test('image paths with spaces, quotes and shell syntax remain one literal argument',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'veil-drop-'));
  try{
    const file=resolve(dir,"photo 'quoted' $(no-command).icns");copyFileSync(image,file);
    const e=entry();assert.equal(imageDrop(e,file).ok,true);
    const result=spawnSync('/bin/sh',['-c',`veil() { printf '%s\\n' "$@"; };\n${e.writes[0].replace(/\r$/,'\n')}`],{encoding:'utf8'});
    assert.equal(result.status,0);assert.deepEqual(result.stdout.trimEnd().split('\n'),['image',file]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
