import {mkdir,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'native/build/veil-pip');
await mkdir(join(root,'native/build'),{recursive:true});
for(const [cmd,args] of [
  ['xcrun',['clang','-fobjc-arc','-mmacosx-version-min=12.0','-framework','AppKit','-framework','ApplicationServices',join(root,'native/veil_pip.m'),'-o',out]],
  ['codesign',['--force','--sign','-','--identifier','com.veilterminal.pip','-r','=designated => identifier "com.veilterminal.pip"',out]],
]) {const result=spawnSync(cmd,args,{stdio:'inherit'});if(result.status!==0)throw Error('PiP helper build failed');}
if(process.argv.includes('--bundle'))await copyFile(out,join(root,'release/Veil Terminal.app/Contents/Resources/app/native/veil-pip'));
