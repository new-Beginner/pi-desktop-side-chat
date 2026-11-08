'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
if(!process.env.PI_SCRATCH_DIR)throw Error('PI_SCRATCH_DIR required');
const root=path.resolve(__dirname,'..'),fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'theme-fixtures.json'),'utf8'));
const profile=fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR,'side-chat-theme-'));
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/javascript; charset=utf-8');res.end(data);});});
let chrome,ws,launchError;const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});chrome.on('error',e=>{launchError=e;});
 let port;for(let i=0;i<100;i++){if(launchError)throw launchError;try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{}await pause(100);}assert.ok(port,'Chrome not ready');
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let id=0;const pending=new Map(),errors=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method));},120000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1100,height:1100,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/tests/theme-follow.html`});
 let original;for(let i=0;i<1200;i++){original=await evaluate('window.__testResult');if(original)break;await pause(50);}assert.ok(original,'original UI suite timed out');assert.equal(original.failed,0,JSON.stringify(original));
 const cases=[];for(const width of [420,320]){
  const result=await evaluate(`window.runThemeChecks(${JSON.stringify(fixtures)},${width})`);cases.push(result);
  if(process.env.SIDE_CHAT_THEME_SCREENSHOT_DIR){fs.mkdirSync(process.env.SIDE_CHAT_THEME_SCREENSHOT_DIR,{recursive:true});for(const theme of fixtures){const rect=await evaluate(`window.previewTheme(${JSON.stringify(theme.id)})`);const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:1}});fs.writeFileSync(path.join(process.env.SIDE_CHAT_THEME_SCREENSHOT_DIR,`${theme.base}-${width}.png`),Buffer.from(shot.data,'base64'));}}
 }
 const result={originalUi:original,passed:cases.reduce((n,c)=>n+c.passed,0),failed:cases.reduce((n,c)=>n+c.failed,0),cases};console.log(JSON.stringify(result,null,2));assert.equal(result.failed,0,'theme checks failed');assert.deepEqual(errors,[]);await call('Browser.close');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{ws?.close();chrome?.kill();server.closeAllConnections?.();server.close();});
