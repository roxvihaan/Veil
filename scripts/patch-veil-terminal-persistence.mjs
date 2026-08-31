import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const rendererPath = join(
  process.cwd(),
  "release",
  "Veil Terminal.app",
  "Contents",
  "Resources",
  "app",
  "dist",
  "client",
  "assets",
  "index-C7zerVBL.js",
);

const source = await readFile(rendererPath, "utf8");
const startMarker = "function Zb({focused:t,config:s,paneId:n,onMeta:a})";
const endMarker = "function Lm({node:t,tabActive:s,activePaneId:n,config:a,onFocus:h,onContextMenu:u,onMeta:f})";
const componentStart = source.indexOf(startMarker);
const cacheStart = source.indexOf("const paneTerminalCache=new Map;");
const start = cacheStart >= 0 && cacheStart < componentStart ? cacheStart : componentStart;
const end = source.indexOf(endMarker, start);

if (componentStart === -1 || start === -1 || end === -1) {
  throw new Error("Could not locate Veil's terminal pane component");
}

const replacement = String.raw`const paneTerminalCache=new Map;
function Zb({focused:t,config:s,paneId:n,onMeta:a}){
  const h=O.useRef(null),u=O.useRef(null);
  O.useEffect(()=>{
    if(!h.current)return;
    let entry=paneTerminalCache.get(n);
    if(!entry){
      const terminal=new Eb(Bg(s)),fit=new Db;
      terminal.loadAddon(fit);
      terminal.loadAddon(new Ob);
      terminal.open(h.current);
      entry={terminal,fit,id:null,mounts:0,disposeTimer:null,onMeta:a,paneId:n,offOutput:null,offExit:null,inputDisposable:null,resizeDisposable:null};
      paneTerminalCache.set(n,entry);
      entry.offOutput=window.veil?.onTerminalData(({id,data})=>{id===entry.id&&Wb(terminal,data)});
      entry.offExit=window.veil?.onTerminalExit(({id,exitCode})=>{id===entry.id&&terminal.writeln("\r\n\x1B[2mProcess exited ("+exitCode+").\x1B[0m")});
      entry.inputDisposable=terminal.onData(data=>{entry.id&&entry.id!=="demo"&&window.veil?.writeTerminal(entry.id,data)});
      entry.resizeDisposable=terminal.onResize(({cols,rows})=>{
        entry.id&&entry.id!=="demo"&&window.veil?.resizeTerminal(entry.id,cols,rows);
        entry.onMeta(entry.paneId,{cols,rows});
      });
      requestAnimationFrame(async()=>{
        if(paneTerminalCache.get(n)!==entry)return;
        try{fit.fit()}catch{}
        if(window.veil){
          const created=await window.veil.createTerminal({cols:terminal.cols,rows:terminal.rows});
          if(paneTerminalCache.get(n)!==entry){window.veil.closeTerminal(created.id);return}
          entry.id=created.id;
          // A fit during the IPC round-trip could not notify a PTY without an id.
          window.veil.resizeTerminal(entry.id,terminal.cols,terminal.rows);
          entry.requestFit?.();
          entry.onMeta(entry.paneId,{shell:created.shell,cwd:created.cwd,cols:terminal.cols,rows:terminal.rows});
        }else{
          entry.id="demo";
          entry.onMeta(entry.paneId,{shell:"zsh",cwd:"~",cols:terminal.cols,rows:terminal.rows});
          jb(terminal);
        }
      });
    }else{
      entry.onMeta=a;
      entry.paneId=n;
      if(entry.terminal.element&&entry.terminal.element.parentElement!==h.current){
        h.current.appendChild(entry.terminal.element);
      }
    }
    entry.mounts+=1;
    clearTimeout(entry.disposeTimer);
    u.current=entry.terminal;
    let frame=0,attempts=0,detached=false;
    const fitToPane=()=>{
      frame=0;
      if(detached||!h.current?.isConnected)return;
      const width=h.current?.clientWidth||0,height=h.current?.clientHeight||0;
      if(!width||!height)return;
      try{
        const dims=entry.fit.proposeDimensions();
        if(!dims||!Number.isFinite(dims.cols)||!Number.isFinite(dims.rows)){
          if(attempts++<8)frame=requestAnimationFrame(fitToPane);
          return;
        }
        entry.fit.fit();
      }catch{}
    };
    const requestFit=()=>{
      if(detached)return;
      attempts=0;
      if(!frame)frame=requestAnimationFrame(fitToPane);
    };
    entry.requestFit=requestFit;
    const observer=new ResizeObserver(requestFit);
    observer.observe(h.current);
    document.fonts?.ready.then(requestFit);
    document.fonts?.addEventListener("loadingdone",requestFit);
    window.addEventListener("resize",requestFit);
    requestFit();
    return()=>{
      detached=true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.fonts?.removeEventListener("loadingdone",requestFit);
      window.removeEventListener("resize",requestFit);
      if(entry.requestFit===requestFit)entry.requestFit=null;
      entry.mounts-=1;
      entry.disposeTimer=setTimeout(()=>{
        if(entry.mounts>0)return;
        entry.offOutput?.();
        entry.offExit?.();
        entry.inputDisposable?.dispose();
        entry.resizeDisposable?.dispose();
        entry.appearanceDisposables?.forEach(disposable=>disposable.dispose());
        if(entry.id&&entry.id!=="demo")window.veil?.closeTerminal(entry.id);
        entry.terminal.dispose();
        paneTerminalCache.delete(n);
      },120);
    };
  },[n]);
  O.useEffect(()=>{
    const terminal=u.current;
    if(!terminal)return;
    const options=Bg(s);
    const entry=paneTerminalCache.get(n);
    const metrics=[options.fontFamily,options.fontSize,options.fontWeight,options.lineHeight,s["padding-x"],s["padding-y"]].join("|");
    for(const key of ["fontFamily","fontSize","fontWeight","lineHeight"]){
      if(terminal.options[key]!==options[key])terminal.options[key]=options[key];
    }
    terminal.options.cursorBlink=options.cursorBlink;
    terminal.options.cursorStyle=options.cursorStyle;
    terminal.options.fontWeightBold=options.fontWeightBold;
    terminal.options.drawBoldTextInBrightColors=options.drawBoldTextInBrightColors;
    terminal.options.theme=options.theme;
    terminal.element?.classList.toggle("veil-no-antialias",s["text-antialias"]===false);
    if(entry){
      const parserSettings=[s["ansi-colors"],s["allow-blinking-text"],s["dynamic-foreground"]].join("|");
      if(entry.parserSettings!==parserSettings){
        entry.parserSettings=parserSettings;
        entry.appearanceDisposables?.forEach(disposable=>disposable.dispose());
        entry.appearanceDisposables=[];
        terminal.write("\x1b[0m");
        if(s["ansi-colors"]===false){
          entry.appearanceDisposables.push(terminal.parser.registerCsiHandler({final:"m"},()=>true));
        }else if(s["allow-blinking-text"]===false){
          entry.appearanceDisposables.push(terminal.parser.registerCsiHandler({final:"m"},params=>Array.from(params.params||[]).includes(5)));
        }
        if(s["dynamic-foreground"]===false){
          entry.appearanceDisposables.push(terminal.parser.registerOscHandler(10,()=>true));
          entry.appearanceDisposables.push(terminal.parser.registerOscHandler(110,()=>true));
        }
      }
    }
    if(entry&&entry.metrics!==metrics){entry.metrics=metrics;entry.requestFit?.()}
  },[s,n]);
  O.useEffect(()=>{
    if(!t)return;
    paneTerminalCache.get(n)?.requestFit?.();
    const frame=requestAnimationFrame(()=>u.current?.focus());
    return()=>cancelAnimationFrame(frame);
  },[t,n]);
  return _e.jsx("div",{className:"terminal-pane",ref:h});
}`;

await writeFile(rendererPath, source.slice(0, start) + replacement + source.slice(end));
const sizing = await readFile(new URL("./veil-split-sizing.css", import.meta.url), "utf8");
await writeFile(join(dirname(dirname(rendererPath)), "split-sizing.css"), sizing);
console.log(`Patched ${rendererPath}`);
