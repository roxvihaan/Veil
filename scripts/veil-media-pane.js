// Move the owning terminal, not a screenshot of its ASCII output. The same Zb
// paneId keeps xterm, scrollback, PTY and the GIF alternate screen alive.
function VeilMovableTerminal({node,focused,config,onMeta,active}){
  const host=O.useRef(null),surface=O.useRef(null),gesture=O.useRef(null),frame=O.useRef(0);
  const [floating,setFloating]=O.useState(false),[portal]=O.useState(()=>document.createElement('div'));
  const [dropError,setDropError]=O.useState(''),[hasImage,setHasImage]=O.useState(()=>!!paneTerminalCache.get(node.id)?.hasImage);
  const position=O.useRef({x:40,y:80,width:400,height:280});
  const clear=()=>{for(const {element} of veilPipPanes.values())element.classList.remove('is-target','is-ready');};
  const paint=()=>{
    frame.current=0;
    const el=surface.current,p=position.current;if(!el)return;
    el.style.transform='translate('+p.x+'px,'+p.y+'px)';
  };
  O.useEffect(()=>{
    portal.className='veil-media-portal';document.body.appendChild(portal);
    const activate=event=>{
      if(event.detail!==node.id||!host.current||floating)return;
      const r=host.current.getBoundingClientRect();
      position.current={x:r.x,y:r.y,width:Math.max(220,r.width),height:Math.max(150,r.height)};
      setFloating(true);
    };
    const escape=event=>{if(event.key==='Escape'){gesture.current=null;clear();setFloating(false);}};
    const resize=()=>{
      const p=position.current;p.x=Math.max(0,Math.min(p.x,window.innerWidth-80));p.y=Math.max(0,Math.min(p.y,window.innerHeight-40));
      if(floating&&!frame.current)frame.current=requestAnimationFrame(paint);
    };
    window.addEventListener('veil:float-media',activate);window.addEventListener('keydown',escape);
    window.addEventListener('resize',resize);
    return ()=>{cancelAnimationFrame(frame.current);frame.current=0;clear();portal.remove();window.removeEventListener('veil:float-media',activate);window.removeEventListener('keydown',escape);window.removeEventListener('resize',resize);};
  },[node.id,floating,portal]);
  O.useLayoutEffect(()=>{if(floating)paint();},[floating]);
  O.useLayoutEffect(()=>{portal.style.display=active?'':'none';},[active,portal]);
  const choose=rect=>{
    const candidates=[];
    for(const [id,{element,node:target,active}] of veilPipPanes){
      if(!active||target.content?.type!=='empty'||!element.isConnected)continue;
      candidates.push({id,element,type:'empty',rect:element.getBoundingClientRect()});
    }
    const best=veilDockGeometry.target(rect,candidates);
    return best?{...best,score:best.strength}:null;
  };
  const move=event=>{
    const drag=gesture.current;if(!drag||drag.id!==event.pointerId)return;
    const p=position.current;
    p.x=Math.max(0,Math.min(window.innerWidth-80,drag.x+event.clientX-drag.px));
    p.y=Math.max(0,Math.min(window.innerHeight-40,drag.y+event.clientY-drag.py));
    p.width=surface.current.offsetWidth;p.height=surface.current.offsetHeight;
    clear();const candidate=choose(p);
    if(candidate){candidate.element.classList.add('is-target');candidate.element.classList.toggle('is-ready',candidate.score>=veilDockTuning.dock);}
    if(!frame.current)frame.current=requestAnimationFrame(paint);
  };
  const finish=event=>{
    if(!gesture.current||gesture.current.id!==event.pointerId)return;
    const candidate=choose(position.current);gesture.current=null;clear();
    if(candidate?.score>=veilDockTuning.dock){setFloating(false);window.dispatchEvent(new CustomEvent('veil:move-media',{detail:{source:node.id,target:candidate.id}}));}
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const terminal=_e.jsx(Zb,{focused,config,paneId:node.id,onMeta});
  const drop=async event=>{
    event.preventDefault();event.stopPropagation();
    const files=event.dataTransfer.files,entry=paneTerminalCache.get(node.id);
    if(files.length!==1){setDropError('Drop one image or GIF.');return;}
    const result=await window.veil?.dropImage?.(entry?.id,files[0]);
    setDropError(result?.ok?'':result?.error||'Image drop unavailable.');
    if(result?.ok){if(entry)entry.hasImage=true;setHasImage(true);entry?.terminal.focus();}
  };
  return _e.jsxs('div',{ref:host,className:'veil-media-host',onDragOver:event=>{
    if(Array.from(event.dataTransfer.types).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}
  },onDrop:drop,children:[
    dropError&&_e.jsx('span',{className:'veil-drop-message',role:'status',children:dropError}),
    hasImage&&!floating&&_e.jsx('button',{className:'veil-image-move',onClick:()=>window.dispatchEvent(new CustomEvent('veil:float-media',{detail:node.id})),children:'Move image / GIF'}),
    floating?_e.jsx('span',{className:'veil-pip-hint',children:'Image / GIF pane is floating'}):terminal,
    floating&&Et.createPortal(_e.jsxs('section',{ref:surface,className:'veil-floating-media',style:{width:position.current.width,height:position.current.height},children:[
      _e.jsxs('div',{className:'veil-media-grip',onPointerDown:event=>{if(event.button!==0||event.target.closest('button'))return;event.preventDefault();event.stopPropagation();gesture.current={id:event.pointerId,px:event.clientX,py:event.clientY,x:position.current.x,y:position.current.y};event.currentTarget.setPointerCapture(event.pointerId);},onPointerMove:move,onPointerUp:finish,
        onPointerCancel:()=>{gesture.current=null;clear();},onLostPointerCapture:()=>{gesture.current=null;clear();},children:[
          _e.jsx('span',{children:'Image / GIF'}),_e.jsx('button',{onClick:()=>setFloating(false),children:'Return to split'})
        ]}),terminal
    ]}),portal)
  ]});
}
