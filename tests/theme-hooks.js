"use strict";
// Test-only adapter around the existing mock; no production chat behavior changes.
let install;
Object.defineProperty(window,"installSideChatMock",{configurable:true,get(){return install;},set(fn){install=win=>{
  fn(win);const on=win.pluginBridge.on.bind(win.pluginBridge),invoke=win.pluginBridge.invoke.bind(win.pluginBridge),listeners=new Set();let current;
  win.pluginBridge.on=(event,handler)=>{if(event==="appearance:changed")listeners.add(handler);const stop=on(event,handler);return()=>{listeners.delete(handler);stop?.();};};
  win.pluginBridge.invoke=(channel,args)=>channel==="app.getAppearance"&&current?Promise.resolve(current):invoke(channel,args);
  win.__themeTest={set(value){current=value;for(const fn of listeners)fn(value);}};
};}});
window.runThemeChecks=async function(fixtures,width=420){
  const frame=document.getElementById("app"),win=frame.contentWindow,doc=win.document;frame.style.width=width+"px";
  const rows=[];let failed=0;const frameWait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const state=()=>JSON.stringify({text:doc.getElementById("log").textContent,draft:doc.getElementById("input").value,model:doc.getElementById("modelSelect").value,thinking:doc.getElementById("thinkSelect").value,history:doc.getElementById("historySelect").value,snapshots:win.__mock.snapshots,mutations:win.__mock.calls.filter(c=>["chat.send","chat.setSettings","chat.delete","chat.select","chat.insert"].includes(c.channel)).length});
  const initial=state();
  const color=(token,property="backgroundColor")=>{const node=doc.createElement("span");node.style.position="fixed";node.style.visibility="hidden";node.style[property]=token.startsWith('--')?`var(${token})`:token;doc.body.append(node);const value=win.getComputedStyle(node)[property];node.remove();return value;};
  const expect=(selector,property,token)=>{const node=doc.querySelector(selector);assert(node,"missing "+selector);const got=win.getComputedStyle(node)[property],wanted=color(token,property);assert(got===wanted,selector+" "+property+": "+got+" != "+wanted);};
  const projectStrip=()=>{
    const strip=doc.getElementById("projectLabel"),style=win.getComputedStyle(strip),rect=strip.getBoundingClientRect();
    assert(style.backgroundColor===win.getComputedStyle(doc.querySelector(".top")).backgroundColor,"project strip background does not match toolbar");
    assert(parseFloat(style.paddingTop)===4&&parseFloat(style.paddingBottom)===4,"project strip vertical padding is not centered");
    assert(parseFloat(style.paddingLeft)===12&&parseFloat(style.paddingRight)===12,"project strip horizontal spacing changed");
    assert(Math.abs(rect.height-parseFloat(style.lineHeight)-8)<0.2,"project strip height changed");
    assert(style.whiteSpace==="nowrap"&&style.textOverflow==="ellipsis"&&style.overflowX==="hidden","project name overflow behavior changed");
    const range=doc.createRange();range.selectNodeContents(strip);const text=range.getBoundingClientRect();
    assert(Math.abs(text.top+text.height/2-rect.top-rect.height/2)<1.5,"project strip text is not visually centered");
    const selectors=[".top","#projectLabel","#log","#form","#ctxBtn","#modelMenuButton","#insertBtn","#sendBtn"];
    const positions=()=>selectors.map(selector=>{const r=doc.querySelector(selector).getBoundingClientRect();return[r.x,r.y,r.width,r.height];});
    const fixed=positions(),inline=strip.getAttribute("style");let previous;
    try{strip.style.padding="8px 12px 0";previous=positions();}finally{inline===null?strip.removeAttribute("style"):strip.setAttribute("style",inline);}
    for(let i=0;i<fixed.length;i++)for(let j=0;j<4;j++)assert(Math.abs(fixed[i][j]-previous[i][j])<0.2,"unrelated geometry changed: "+selectors[i]);
  };
  const apply=async theme=>{win.__themeTest.set({theme:"plugin:"+theme.id,base:theme.base,locale:"zh-CN",pluginTheme:{id:theme.id,base:theme.base,css:theme.css}});await frameWait();frame.style.backgroundColor=color('--ds-bg-primary');};
  const check=async(name,fn)=>{try{await fn();rows.push({name,passed:true});}catch(error){failed++;rows.push({name,passed:false,error:error.message});}};
  for(const theme of fixtures){
    await apply(theme);
    await check(theme.label+" background/text/border",()=>{expect("body","backgroundColor","--ds-bg-dock");expect(".top","backgroundColor","--ds-bg-dock");expect(".composer","backgroundColor","--ds-bg-dock");expect("body","color","--ds-text-primary");expect(".project-label","color","--ds-text-secondary");expect(".top","borderBottomColor","--ds-border-default");});
    await check(theme.label+" buttons and input",()=>{expect(".icon-btn","backgroundColor","--ds-bg-elevated-opaque");expect(".box","backgroundColor","--ds-bg-elevated-opaque");expect(".send","backgroundColor","--ds-accent");expect(".send","color","--ds-bg-primary");assert(win.getComputedStyle(doc.getElementById("input"),"::placeholder").color===color("--ds-placeholder-ink","color"),"placeholder did not follow host");});
    await check(theme.label+" both message bubbles",()=>{expect(".msg:not(.user)","backgroundColor","--ds-bg-elevated-opaque");expect(".msg.user","backgroundColor","--ds-bg-active");expect(".msg.user","color","--ds-text-primary");});
    await check(theme.label+" project strip background/centering/unchanged geometry",projectStrip);
    await check(theme.label+" does not mutate chat/history/model",()=>assert(state()===initial,"theme changed business state"));
  }
  // Same base, id AND byte count: only CSS values differ.
  const light=fixtures.find(t=>t.base==="light");await apply(light);
  const updated={...light,css:light.css.replace("#356c45","#456c35")};assert(updated.css!==light.css&&updated.css.length===light.css.length,"equal-length fixture missing");
  await apply(updated);await check("same-theme equal-length CSS update",()=>{expect(".send","backgroundColor","--ds-accent");assert(win.getComputedStyle(doc.querySelector(".send")).backgroundColor==="rgb(69, 108, 53)","equal-length update ignored");});
  for(const base of ["dark","light"]){
    win.__themeTest.set({theme:base,base,locale:"zh-CN",pluginTheme:null});await frameWait();
    await check(base+" defaults without host tokens",()=>{const p=base==="light"?['#f5faff','#ffffff','#183b5b','#617d96','#dbe8f2','#2776b5','#ffffff','#e2f0fc']:['#152332','#1b2c3d','#e2edf7','#9bb2c7','#32485c','#80bcf0','#102335','#244663'];for(const [selector,property,index] of [['body','backgroundColor',0],['.icon-btn','backgroundColor',1],['body','color',2],['.project-label','color',3],['.top','borderBottomColor',4],['.send','backgroundColor',5],['.send','color',6],['.msg.user','backgroundColor',7],['.msg.user','color',2],['.msg:not(.user)','backgroundColor',1]])assert(win.getComputedStyle(doc.querySelector(selector))[property]===color(p[index],property),'fallback changed '+selector+'/'+property);assert(!doc.getElementById("pi-appearance-theme-css"),"old theme CSS retained");});
    await check(base+" default project strip background/centering/unchanged geometry",projectStrip);
  }
  // A dark -> light -> dark -> light transition reuses the same live page.
  for(const theme of [fixtures[1],fixtures[0],fixtures[1],fixtures[0]])await apply(theme);
  await check("realtime round trip and unchanged state",()=>{expect("body","backgroundColor","--ds-bg-dock");assert(state()===initial,"round trip changed business state");});
  window.previewTheme=async id=>{await apply(fixtures.find(t=>t.id===id));doc.getElementById("log").scrollTop=0;await frameWait();return frame.getBoundingClientRect().toJSON();};
  return{width,passed:rows.length-failed,failed,rows};
};
