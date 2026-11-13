import json, pathlib, html
root=pathlib.Path(__file__).resolve().parent.parent
all=[]
for f in sorted((root/'levels').glob('*.json')):
 all.extend(json.loads(f.read_text(encoding='utf-8'))['stages'])
data=json.dumps(all,ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
s=r'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>StudioKit Arcade · 78关策划预览图谱</title><style>
:root{color-scheme:dark;--bg:#0b1020;--fg:#e5eeff;--muted:#8da3c5;--line:#35435a;--accent:#77cce7}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% -20%,#172b50,var(--bg) 50%);color:var(--fg);font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
header{max-width:1180px;margin:0 auto;padding:22px 18px}h1{font-size:23px;margin:0}p{color:var(--muted);margin:5px 0 14px}main{max-width:1180px;padding:0 16px 30px;margin:auto;display:grid;grid-template-columns:minmax(185px,260px) minmax(300px,440px) minmax(240px,1fr);gap:15px;align-items:start}
.panel{border:1px solid var(--line);border-radius:14px;background:#121c30;padding:16px}.small{font-size:12px;color:var(--muted)}button,select{background:#192b45;color:var(--fg);border:1px solid #465677;border-radius:9px;padding:10px 12px;font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible{outline:2px solid var(--accent)}select{width:100%;margin-bottom:14px}.six{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.six button{padding:9px 3px}.six button.active{background:#20617f;border-color:#7fe3f7}.label{font-size:13px;color:var(--muted);margin:8px 0}canvas{display:block;max-width:100%;height:auto;border-radius:10px;background:#0c1627;margin:0 auto}h2{font-size:20px;margin:0 0 10px}h3{font-size:15px;margin:18px 0 4px}ul{padding-left:18px}li{margin:5px 0}details{margin-top:16px}summary{cursor:pointer;font-weight:bold}pre{overflow:auto;max-height:450px;padding:12px;background:#060b13;border-radius:8px;font-size:11px;white-space:pre-wrap;word-break:break-all}.note{border-left:3px solid var(--accent);padding-left:10px;color:#bed4ee}.pill{display:inline-block;font-size:12px;padding:2px 8px;background:#1c3853;border-radius:99px;color:#a6e9ef}
@media(max-width:1000px){main{grid-template-columns:220px minmax(300px,1fr)}.info{grid-column:1/-1}}@media(max-width:620px){main{display:block}.panel{margin:0 0 12px}h1{font-size:20px}}
</style></head><body><header><h1>StudioKit Arcade · 78 关游戏策划图谱</h1><p>13 款游戏 × 每款 6 关。离线预览关卡结构、事件脚本与设计约束。<b>这不是可以游玩的引擎，也没有物理通关验证功能。</b></p></header><main>
<section class="panel"><div class="label">选择游戏</div><select id="game"></select><div class="label">选择关卡</div><div id="buttons" class="six"></div><h3>显示内容</h3><p class="small">平台/铃点、棋盘、矿点、砖阵、路线、敌人脚本、时序等布局预览。注意任何像素比例都是策划图谱，游戏中必须通过现有视口和物理适配层渲染。</p></section>
<section class="panel"><canvas id="c" width="420" height="740" aria-label="本关静态布局图"></canvas><p class="small">图示不能证明操作可达；蓝线通常表示候选主线或可行时隙，黄色为可选支路/奖励。</p></section>
<section class="panel info"><div class="pill" id="sid"></div><h2 id="title"></h2><p id="goal"></p><h3>玩家的选择</h3><div id="decision"></div><h3>这一关练什么</h3><div id="skill"></div><h3>探索内容</h3><div id="discovery"></div><h3>参考解与验收</h3><div id="plan" class="note small"></div><details><summary>查看完整机器可读单关 JSON</summary><pre id="raw"></pre></details></section>
</main><script id="json" type="application/json">__DATA__</script><script>
const stages=JSON.parse(document.getElementById('json').textContent);const gameSel=document.getElementById('game'), btns=document.getElementById('buttons');const c=document.getElementById('c'),x=c.getContext('2d');
const names={'shadow-leap':'影跃','snowbells':'雪铃','star-raid':'星海突击','pendulum-tower':'层塔','block-drop':'俄罗斯方块','road-rush':'极速车道','gold-miner':'黄金矿工','brick-breaker':'砖块计划','gravity-flip':'重力翻转','snake-run':'贪吃蛇','mole-whack':'打地鼠','memory-flip':'记忆翻牌','merge-2048':'2048 合成'};
Object.entries(names).forEach(([k,v])=>{let op=document.createElement('option');op.value=k;op.textContent=v;gameSel.append(op)});let current=stages[0];
function rect(a,b,w,h,color){x.fillStyle=color;x.fillRect(a,b,w,h)}function line(points,color='#69e1f3',width=2){x.strokeStyle=color;x.lineWidth=width;x.beginPath();points.forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b));x.stroke()}
function txt(str,a,b,color='#a4bcd8',size=13,align='left'){x.fillStyle=color;x.font=size+'px system-ui';x.textAlign=align;x.fillText(String(str),a,b);x.textAlign='left'}
function ball(a,b,r,color){x.beginPath();x.arc(a,b,r,0,Math.PI*2);x.fillStyle=color;x.fill()}
function grid(board,x0,y0,cell, colors){board.forEach((r,ri)=>Array.from(r).forEach((v,ci)=>{rect(x0+ci*cell,y0+ri*cell,cell-2,cell-2,colors(v,ri,ci));if(!['.','#',0].includes(v))txt(v,x0+ci*cell+cell/2,y0+ri*cell+cell*.63,'#f9fcff',Math.min(cell*.52,17),'center')}))}
function draw(s){x.clearRect(0,0,420,740);rect(0,0,420,740,'#0a1426');for(let z=0;z<34;z++){let a=(z*73+27)%420,b=(z*199+51)%740;ball(a,b,1.1,'#243d58')}
 txt(s.id,15,29,'#9be8fa',13);txt(s.title,15,57,'#ffffff',20);const d=s.content,g=s.gameId;
 if(g==='shadow-leap'){
  const map=new Map(d.platforms.map(p=>[p.id,p]));const point=p=>[p.xCenter,676-p.height*1.23];for(let key of ['mainRoute','alternativeRoute']){let pts=d[key].filter(id=>map.has(id)).map(id=>point(map.get(id)));if(pts.length>1)line(pts,key==='mainRoute'?'#6bdbeb':'#ffd16b',3)}
  for(let p of d.platforms){let [a,b]=point(p);rect(a-p.width/2,b,p.width,12,p.kind==='moving'?'#8c74e0':p.kind==='fragile'?'#ce935e':'#477a93');txt(p.id,a,b-6,'#d6eaf9',11,'center')}
  let gy=676-d.goal.height*1.23;ball(d.goal.xCenter,gy,13,'#ecbe68');txt('出口',d.goal.xCenter,gy-17,'#ffde90',12,'center');txt('主线: 蓝／支线: 黄',16,710)}
 else if(g==='snowbells'){
  const byid=new Map(d.bells.map(b=>[b.id,b]));line(d.requiredSequence.map(id=>{let v=byid.get(id);return[v.xCenter,670-v.height*1.12]}));for(let b of d.bells){let yy=670-b.height*1.12;ball(b.xCenter,yy,12,b.kind==='rest'?'#8e92ac':b.kind==='bonus'?'#f5cb65':'#64d9ce');txt(b.id+' '+b.kind,b.xCenter,yy-17,'#effcff',11,'center')}
  txt('序列 '+d.requiredSequence.join('→'),15,711)}
 else if(g==='block-drop'){
  grid(d.boardTopToBottom.map(r=>Array.from(r)),87,110,24,v=>v==='#'?'#617a9e':'#1c2b44');txt('队列 '+d.pieceQueue.join(' → '),20,631);txt('目标 '+d.win.count+' 行',20,667)}
 else if(g==='merge-2048'){
  grid(d.initialBoard,47,180,81,v=>v?'#3b6d83':'#25374f');txt('目标 ≥ '+d.win.anyTileAtLeast+' · 限'+d.maxValidMoves+'步',25,570);txt('参考: '+s.referencePlan.directions.join(' → '),25,610)}
 else if(g==='memory-flip'){
  let v=d.faces, cell=Math.min(78,320/v[0].length);grid(v,55,160,cell,()=> '#456a80');txt('预览 '+d.previewSeconds+' 秒 / 最多错误 '+d.maxMismatches+' 次',21,565);txt('参考配对见右侧JSON',21,607)}
 else if(g==='brick-breaker'){
  grid(d.brickRows.map(r=>Array.from(r)),20,200,48,v=>({'1':'#427c9b','2':'#4462ad','3':'#8260ad','K':'#dbab52','G':'#75879e'}[v]||'#10192c'));txt('1/2/3 HP · K钥匙 · G机关门',20,510)}
 else if(g==='snake-run'){
  const o=new Set(d.walls.map(q=>q.join(','))),f=d.fruitQueue;const b=new Set(d.initialSnake.map(q=>q.join(',')));let v=[];for(let y=0;y<18;y++){let r=[];for(let a=0;a<18;a++){let p=a+','+y;r.push(o.has(p)?'#':b.has(p)?'S':(f.some(t=>t[0]===a&&t[1]===y)?'●':'.'))}v.push(r)}grid(v,30,160,20,(z)=>z==='#'?'#776c9a':z==='S'?'#69c5a7':z==='●'?'#e0ae64':'#1e2d43');txt('参考转向 '+s.referencePlan.movesRLE.join(' '),12,574,'#a6cbe2',11)}
 else if(g==='road-rush'){
  const a=55,y0=123,cw=75,ch=35;d.timeline.forEach((ev,i)=>{for(let lane=0;lane<4;lane++){rect(a+lane*cw,y0+i*ch,cw-3,ch-3,ev.occupiedLanes.includes(lane)?'#a24f5b':'#2b5969')}txt(''+(i+1),19,y0+i*ch+23,'#cbd9ee',11)});line(s.referencePlan.safeLaneBySlot.slice(1).map((lane,i)=>[a+lane*cw+cw/2,y0+i*ch+ch/2]),'#65f3bb',4);txt('绿色折线：离散安全车道序列',20,611)}
 else if(g==='gold-miner'){
  const p=[210,104];ball(...p,8,'#64d9e9');for(let id of d.referenceCatchOrder){let o=d.items.find(v=>v.id===id);line([p,[o.x,o.y]],'#b6d65e',1)}for(let e of d.items){ball(e.x,e.y,Math.min(19,e.weight*1.5+8),e.type==='tnt'?'#d05e67':e.type==='diamond'?'#71d2eb':e.type.startsWith('gold')?'#d7b65f':'#69788d');txt(e.id,e.x,e.y-20,'#c9e3f3',11,'center')}txt('目标 $'+d.targetMoney+' / '+d.timeLimitSec+'s',18,675)}
 else if(g==='gravity-flip'){
  const max=d.distanceToFinish, toX=v=>50+v/max*323;line([[50,210],[375,210]],'#64718e',3);line([[50,540],[375,540]],'#64718e',3);
  for(let e of d.obstacles){let a=toX(e.x),h=Math.min(170,e.height*.68);rect(a-6,e.side==='ceiling'?210:540-h,12,h,'#d2706d');txt(e.id,a,e.side==='ceiling'?198:560,'#e2d4c5',11,'center')}
  for(let a of d.recommendedFlipWindows){let xx=toX(a.xCenter);ball(xx,375,4,'#72d7dd');txt(a.toward==='ceiling'?'↑':'↓',xx,356,'#a3e9ff',18,'center')}txt('横轴：相对前进距离',20,640)}
 else if(g==='pendulum-tower'){
  let by=610;rect(98,by+20,225,12,'#4d6575');line([[210,160],[210,644]],'#57758a',1);d.boxes.forEach((b,i)=>{let xx=210+b.targetOffsetPx;rect(xx-32,by-i*44-32,64,39,i%2?'#8d9dca':'#d0ac6f');txt(''+b.order,xx,by-i*44-9,'#102038',14,'center')});txt('各层目标位置不代表物理吸附',15,705)}
 else if(g==='mole-whack'){
  for(let i=0;i<9;i++){let a=84+i%3*94,b=178+Math.floor(i/3)*94;ball(a+35,b+35,36,'#3b536b');txt(i,a+35,b+44,'#e8f3ff',21,'center')};d.events.slice(0,14).forEach((ev,i)=>txt(ev.atSec+'s · 洞'+ev.slot+' · '+ev.kind,24,503+i*15,'#bbd0e8',11))}
 else if(g==='star-raid'){
  const max=d.stageDurationSec;d.events.forEach((ev,i)=>{let a=60+ev.spawnXRatio*300,b=135+ev.atSec/max*460;ball(a,b,10,ev.enemyType==='boss'?'#e6bd72':ev.enemyType==='charger'?'#db7675':'#6bb4db');txt(ev.atSec+'s '+ev.attackPattern,15,b-14,'#d8e1ef',10)});txt('事件时间向下推进；敌人横向位置按比例',18,693,'#adc8de',11)}
 txt('静态设计预览 · 非引擎截图',210,734,'#608098',10,'center')
}
function activate(g,i){const found=stages.find(s=>s.gameId===g&&s.stageNumber===i);if(!found)return;current=found;document.querySelectorAll('#buttons button').forEach((b,k)=>b.classList.toggle('active',k===i-1));
 for(let [k,v] of Object.entries({sid:found.id,title:found.title,goal:found.goalStatement,decision:found.decision,skill:found.practicedSkill,discovery:found.discovery,plan:'参考方案：'+JSON.stringify(found.referencePlan)}))document.getElementById(k).textContent=v;document.getElementById('raw').textContent=JSON.stringify(found,null,2);draw(found)}
function chooseGame(g){btns.replaceChildren();for(let i=1;i<=6;i++){let b=document.createElement('button');b.textContent='C'+String(i).padStart(2,'0');b.onclick=()=>activate(g,i);btns.appendChild(b)}activate(g,1)}gameSel.onchange=()=>chooseGame(gameSel.value);gameSel.value='shadow-leap';chooseGame(gameSel.value);
</script></body></html>'''
s=s.replace('__DATA__',data)
(root/'LEVEL-ATLAS.html').write_text(s,encoding='utf-8')
print('atlas',len(s),'bytes')
