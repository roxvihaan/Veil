// Injected alongside the shipped React module; O / _e are its React bindings.
// Geometry updates are event-driven. No terminal output or input hooks.
const veilPipPanes=new Map;
const veilPipConnectTokens=new Map;
let veilPipReportFrame=0;
function veilReportPipPanes(){
  cancelAnimationFrame(veilPipReportFrame);
  veilPipReportFrame=requestAnimationFrame(()=>{
    const panes=[];
    for(const [id,{element,node,active}] of veilPipPanes){
      if(!active||!element.isConnected||!element.getClientRects().length)continue;
      const {x,y,width,height}=element.getBoundingClientRect();
      panes.push({id,type:node.content?.type||'terminal',windowId:node.content?.windowId,rect:{x,y,width,height}});
    }
    window.veil?.pipPanes?.(panes);
  });
}
function veilMapPane(tree,id,update){
  if(tree.type==='pane')return tree.id===id?update(tree):tree;
  return {...tree,children:tree.children.map(child=>veilMapPane(child,id,update))};
}
function VeilPipPane({node,active,onContextMenu,onFocus}){
  const ref=O.useRef(null),[status,setStatus]=O.useState('Finding PiP windows…'),[windows,setWindows]=O.useState([]),[permission,setPermission]=O.useState(false);
  const linked=node.content?.type==='external-pip';
  O.useEffect(()=>{
    const element=ref.current;
    veilPipPanes.set(node.id,{element,node,active});
    const observer=new ResizeObserver(veilReportPipPanes);observer.observe(element);veilReportPipPanes();
    const off=window.veil?.onPiP?.(message=>{
      if(message.type==='preview'){
        const strength=message.paneId===node.id?message.strength:0;
        element.style.setProperty('--dock-strength',strength);
        element.classList.toggle('is-target',strength>0);
        element.classList.toggle('is-ready',strength>=veilDockTuning.dock);
        if(localStorage.getItem('veil.pip.debug')==='1')element.dataset.debug=strength?Math.round(strength*100)+'% overlap':'';
      }
      if(message.type==='windows'){setWindows(message.windows);setStatus(message.windows.length?'Choose your PiP window (not the main app window)':'No controllable windows found. Open a PiP, then retry.');setPermission(false);}
      if(message.type==='tracking'){setWindows([]);setStatus('Connecting PiP…');setPermission(false);}
      if(message.type==='permission'){setStatus(message.message);setPermission(true);}
      if(message.type==='error'||message.type==='gone'){setStatus(message.message||'PiP closed or became inaccessible. Select again.');setWindows([]);}
    });
    if(node.connectToken&&veilPipConnectTokens.get(node.id)!==node.connectToken){
      veilPipConnectTokens.set(node.id,node.connectToken);
      window.veil?.pipAction?.({op:'start'});
    }
    return ()=>{off?.();observer.disconnect();veilPipPanes.delete(node.id);veilReportPipPanes();};
  },[node,active]);
  return _e.jsxs('div',{ref,className:'pane-leaf veil-pip-pane', 'data-pane-id':node.id,'data-content-type':node.content.type,
    onMouseDown:()=>onFocus(node.id),onContextMenuCapture:event=>onContextMenu(event,node.id),children:[
      _e.jsx('span',{className:'veil-pip-hint',children:linked?'PiP · drag away to detach':status}),
      !linked&&_e.jsxs('div',{className:'veil-pip-actions',children:[
        _e.jsx('button',{onClick:()=>window.veil?.pipAction?.({op:'start',prompt:permission}),children:permission?'Allow Accessibility / retry':'Find PiP windows'}),
        ...windows.map(w=>_e.jsx('button',{onClick:()=>window.veil?.pipAction?.({op:'select',id:w.id,paneId:node.id,mode:node.pipMode||'bound'}),children:w.title+' · '+w.id},w.id)),
        windows.length>0&&_e.jsx('button',{onClick:()=>window.veil?.pipAction?.({op:'scan'}),children:'Refresh windows'})
      ]}),
      _e.jsx('button',{className:'veil-pip-release',onClick:()=>{window.veil?.pipAction?.({op:'stop'});setStatus('PiP disconnected');setWindows([]);},children:linked?'Detach PiP':'Stop tracking'})
      ,node.parkedTerminal&&_e.jsx('button',{className:'veil-pip-release',onClick:()=>{
        if(linked)window.veil?.pipAction?.({op:'stop'});
        window.dispatchEvent(new CustomEvent('veil:restore-terminal',{detail:node.id}));
      },children:'Return to terminal'})
    ]});
}
