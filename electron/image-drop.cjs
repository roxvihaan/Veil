const path=require('node:path');
const fs=require('node:fs');
const extensions=new Set(['.png','.jpg','.jpeg','.gif','.icns','.webp','.bmp','.tif','.tiff','.heic','.heif','.avif']);
// Conservative input bookkeeping: complex editing/history is unknown until the
// next submitted/cancelled line. Never append an executable command to it.
function trackInput(entry,data){
  for(const character of data){
    if(character==='\r'||character==='\n'||character==='\x03'){entry.inputLength=0;entry.inputUnknown=false;}
    else if(character==='\x7f'||character==='\b'){entry.inputLength=Math.max(0,entry.inputLength-1);}
    else if(character==='\x15'&&!entry.inputUnknown){entry.inputLength=0;}
    else if(character<' '){entry.inputUnknown=true;}
    else entry.inputLength++;
  }
}
function imageDrop(entry,file){
  if(!entry||typeof file!=='string'||!path.isAbsolute(file)||!extensions.has(path.extname(file).toLowerCase()))
    return {ok:false,error:'Drop one image or GIF file.'};
  try{if(!fs.statSync(file).isFile())throw Error();}catch{return {ok:false,error:'That image file is not available.'};}
  const shell=path.basename(entry.shellPath||'');
  let foreground;try{foreground=path.basename(entry.terminal.process).replace(/^-/, '');}catch{}
  if(!['zsh','bash','sh','ksh','fish'].includes(shell)||foreground!==shell||entry.inputLength||entry.inputUnknown||Date.now()-(entry.lastImageDrop||0)<300)
    return {ok:false,error:'Use an empty shell prompt before dropping an image.'};
  const quoted="'"+file.replaceAll("'", "'\\''")+"'";
  entry.terminal.write('veil image '+quoted+'\r');
  // Don't allow a second drop to race the shell's first command.
  entry.lastImageDrop=Date.now();
  return {ok:true};
}
module.exports={trackInput,imageDrop};
