// Screen coordinates are macOS points / Electron DIPs, never backing pixels.
const TUNING = Object.freeze({ preview: .28, dock: .62, minWidth: 160, minHeight: 100, undock: 32, stiffness: 390, damping: 32 });
const valid = r => r && ['x','y','width','height'].every(k => Number.isFinite(r[k])) && r.width >= 1 && r.height >= 1;
function overlap(a,b) {
  if (!valid(a) || !valid(b)) return 0;
  const area = Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return area / Math.min(a.width*a.height,b.width*b.height);
}
function target(rect,panes) {
  return panes.filter(p=>p.type==='empty' && p.rect.width>=TUNING.minWidth && p.rect.height>=TUNING.minHeight)
    .map(p=>({...p,strength:overlap(rect,p.rect)})).filter(p=>p.strength>=TUNING.preview)
    .sort((a,b)=>b.strength-a.strength || a.id.localeCompare(b.id))[0] || null;
}
function fit(rect,aspect) {
  const width=Math.min(rect.width,rect.height*aspect),height=width/aspect;
  return {x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height};
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
module.exports={TUNING,valid,overlap,target,fit,distance};
