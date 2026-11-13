#!/usr/bin/env python3
"""StudioKit Arcade 0.9 content validation. No network, no repo writes.
Machine checks validate static data / simple reference simulators; physical playability requires original engine harness.
"""
import json, pathlib, collections, itertools, math, sys
ROOT=pathlib.Path(__file__).resolve().parent.parent
GAMES=['shadow-leap','snowbells','star-raid','pendulum-tower','block-drop','road-rush','gold-miner','brick-breaker','gravity-flip','snake-run','mole-whack','memory-flip','merge-2048']
errors=[];checks=collections.Counter()
def ck(v,msg,cat):
 checks[cat]+=1
 if not v:errors.append(msg)
def each():
 for g in GAMES:
  p=ROOT/'levels'/f'{g}.json'
  ck(p.is_file(),f'missing {p}','inventory')
  if not p.exists():continue
  f=json.loads(p.read_text('utf-8'))
  ck(f['gameId']==g,f'{g} game id mismatch','inventory')
  ck(len(f['stages'])==6,f'{g} must contain 6 levels, actual {len(f["stages"])}','inventory')
  for i,s in enumerate(f['stages'],1):
   id=s['id'];c=s['content'];w=s['referencePlan']
   ck(id==f'{g}-C{i:02d}',f'{id} id sequence','inventory')
   ck(all(bool(s.get(k)) for k in ['goalStatement','decision','practicedSkill','discovery','acceptance']),f'{id} design fields incomplete','design-contract')
   ck(s.get('mode')=='challenge' and s['integration']['separateClassicProgress'],f'{id} classic isolation','design-contract')
   ck(bool(w),f'{id} missing reference plan','design-contract')
   if g=='shadow-leap':
    ps={p['id']:p for p in c['platforms']}
    ck(len(ps)==len(c['platforms']),f'{id} duplicate platform id','geometry')
    for p in ps.values():ck(0<=p['xCenter']-p['width']/2 and p['xCenter']+p['width']/2<=420,f'{id} platform {p["id"]} outside world','geometry')
    for path in [c['mainRoute'],c['alternativeRoute']]:
     ck(all(x in ps for x in path),f'{id} bad route id','geometry')
     for a,b in zip(path,path[1:]):
      if a in ps and b in ps:ck(ps[b]['height']-ps[a]['height']<=136.5,f'{id} unreachable height gap: {a}->{b}','geometry')
    ck(c['goal']['height']-ps[c['mainRoute'][-1]]['height']<=136.5,f'{id} gate too high','geometry')
   elif g=='snowbells':
    bells={b['id']:b for b in c['bells']}; seq=c['requiredSequence']
    ck(len(bells)==len(c['bells']),f'{id} bell duplicates','geometry')
    ck(all(x in bells for x in seq),f'{id} missing bell in required sequence','geometry')
    for a,b in zip(seq,seq[1:]):ck(bells[b]['height']-bells[a]['height']<=159,f'{id} bell rise >159: {a}->{b}','geometry')
   elif g=='block-drop':
    simulate_tetris(s)
   elif g=='merge-2048':
    simulate_2048(s)
   elif g=='road-rush':
    plan=w['safeLaneBySlot']; slots=c['timeline']; ck(plan is not None and len(plan)==len(slots)+1, f'{id} missing road witness','exact-simulation')
    if plan and len(plan)==len(slots)+1:
     ck(plan[0]==c['startLane'],f'{id} incorrect start lane','exact-simulation')
     for j,(l,entry) in enumerate(zip(plan[1:],slots)):
      ck(l not in entry['occupiedLanes'] and 0<=l<4 and abs(l-plan[j])<=1,f'{id} blocked/unreachable at slot {j+1}','exact-simulation')
   elif g=='snake-run':
    simulate_snake(s)
   elif g=='memory-flip':
    board=c['faces']; n=len(board)*len(board[0]);f=collections.Counter(x for row in board for x in row)
    ck(all(v==2 for v in f.values()) and n==2*len(f),f'{id} invalid pairs','exact-simulation')
    pairs=w['pairs'];ck(len(pairs)==len(f),f'{id} mismatched witness pair count','exact-simulation')
    for obj in pairs:
     coords=obj['positions'];sym=obj['symbol'];ck(len(coords)==2 and all(board[r][col]==sym for r,col in coords),f'{id} invalid pair location {sym}','exact-simulation')
   elif g=='gold-miner':
    items={t['id']:t for t in c['items']};order=c['referenceCatchOrder'];radius={'goldS':9,'goldM':14,'goldL':20,'diamond':8,'rockS':13,'rockL':19,'tnt':11}
    ck(len(items)==len(c['items']),f'{id} duplicate item ID','geometry')
    ck(sum(items[k]['value'] for k in order)>=c['targetMoney'],f'{id} witness value too low','exact-simulation')
    for pick in order:
     t=items[pick];x=t['x']-210;y=t['y']-104;norm=math.hypot(x,y);ux,uy=x/norm,y/norm
     for other in items.values():
      if other['id']==pick or other['id'] in order[:order.index(pick)]:continue # already removed
      ax,ay=other['x']-210,other['y']-104;pr=ax*ux+ay*uy;sep=abs(ax*uy-ay*ux)
      ck(not(0<pr<norm and sep < radius[other['type']]+12),f'{id} hook may intercept {other["id"]} before {pick}', 'ray-clearance')
   elif g=='mole-whack':
    ev=c['events'];valid=[e for e in ev if e['kind'] in ('gold','normal')]
    ck(len(valid)>=c['win']['minValidHits'] and len([e for e in ev if e['kind']=='gold'])>=c['win']['minGoldHits'],f'{id} target too high','exact-simulation')
    for a,b in itertools.combinations(ev,2):
     if a['slot']==b['slot']:ck(abs(a['atSec']-b['atSec'])>=min(a['visibleSec'],b['visibleSec']),f'{id} overlapping mole in slot {a["slot"]}','geometry')
   elif g=='brick-breaker':
    rows=c['brickRows'];ck(len(rows)==5 and all(len(r)==8 for r in rows),f'{id} brick map wrong size','geometry')
    ck(all(ch in '123KG.' for row in rows for ch in row),f'{id} unknown brick token','geometry')
    if any('G' in row for row in rows):ck(any('K' in row for row in rows),f'{id} sealed door with no key','geometry')
   elif g=='star-raid':
    es=c['events'];ck(all(0<e['atSec']<c['stageDurationSec'] for e in es),f'{id} invalid wave event time','timeline')
    ck(all(0<=e['spawnXRatio']<=1 and e['telegraphSec']>=.9 for e in es),f'{id} invalid wave warning','timeline')
   elif g=='gravity-flip':
    es=c['obstacles'];ck(all(es[i+1]['x']-es[i]['x']>=340 for i in range(len(es)-1)),f'{id} obstacles too dense','geometry')
    ck(all(e['telegraphLeadPx']>=350 for e in es),f'{id} no reaction lead','geometry')
   elif g=='pendulum-tower':
    bs=c['boxes'];ck(len(bs)==c['win']['floorsAtLeast'],f'{id} wrong box order','geometry')
    ck(all(abs(b['targetOffsetPx'])<=16 for b in bs),f'{id} target center beyond stability margin','geometry')

def tetris_drop(board, piece, orient, left, defs):
 shape=defs[f'{piece}-{orient}'];dx=max(x for x,y in shape);dy=max(y for x,y in shape)
 if left<0 or left+dx>=10:return None
 def fit(y):
  for px,py in shape:
   yy=y+py
   if yy>=20 or (yy>=0 and board[yy][left+px]!='.'):return False
  return True
 yy=-4
 if not fit(yy):return None
 while fit(yy+1):yy+=1
 if yy<0:return None
 b=[list(r) for r in board]
 for x,y in shape:b[yy+y][left+x]='#'
 filtered=[r for r in b if not all(x=='#' for x in r)]
 n=20-len(filtered)
 return ['.'*10 for _ in range(n)]+[''.join(row) for row in filtered], n

def simulate_tetris(s):
 id=s['id']; c=s['content'];b=list(c['boardTopToBottom']); total=0
 ck(len(b)==20 and all(len(r)==10 and set(r)<=set('.#') for r in b),f'{id} invalid tetris board','exact-simulation')
 ck(len(s['referencePlan'])==len(c['pieceQueue']),f'{id} wrong piece plan size','exact-simulation')
 for j,act in enumerate(s['referencePlan']):
  ck(act['piece']==c['pieceQueue'][j],f'{id} wrong piece sequence','exact-simulation')
  result=tetris_drop(b,act['piece'],act['orientation'],act['leftCol'],c['pieceDefinitions'])
  ck(result is not None,f'{id} placement cannot hard-drop: #{j+1}','exact-simulation')
  if result is None:return
  b,cleared=result;total+=cleared
 ck(total>=c['win']['count'],f'{id} solution clears {total} but target {c["win"]["count"]}','exact-simulation')

def merge_line(v):
 a=[x for x in v if x];out=[];i=0
 while i<len(a):
  if i+1<len(a) and a[i]==a[i+1]:out.append(2*a[i]);i+=2
  else:out.append(a[i]);i+=1
 return out+[0]*(4-len(out))
def merge_step(board,dir):
 b=[list(x) for x in board]
 if dir in 'LR':
  for i in range(4):
   inp=b[i] if dir=='L' else b[i][::-1];v=merge_line(inp);b[i]=v if dir=='L' else v[::-1]
 else:
  for j in range(4):
   inp=[b[i][j] for i in range(4)];inp=inp if dir=='U' else inp[::-1]
   v=merge_line(inp);v=v if dir=='U' else v[::-1]
   for i in range(4):b[i][j]=v[i]
 return b

def simulate_2048(s):
 id=s['id'];c=s['content'];b=c['initialBoard'];ds=s['referencePlan']['directions']
 ck(ds is not None,f'{id} no 2048 solution','exact-simulation')
 if ds is None:return
 ck(len(ds)<=c['maxValidMoves'],f'{id} exceed 2048 move budget','exact-simulation')
 for d in ds:
  nxt=merge_step(b,d)
  ck(nxt!=b,f'{id} move {d} not effective','exact-simulation')
  b=nxt
 ck(max(max(row) for row in b)>=c['win']['anyTileAtLeast'],f'{id} target not reached','exact-simulation')
 ck(b==s['referencePlan']['resultBoard'],f'{id} result board mismatch','exact-simulation')

def simulate_snake(s):
 id=s['id'];c=s['content'];plan=s['referencePlan']['movesRLE'];b=[tuple(x) for x in c['initialSnake']];bad=set(tuple(x) for x in c['walls']);fruits=[tuple(x) for x in c['fruitQueue']]
 d=c['initialDirection'];D={'R':(1,0),'L':(-1,0),'U':(0,-1),'D':(0,1)};opp={'R':'L','L':'R','U':'D','D':'U'}
 for token in plan:
  direc=token[0];n=int(token[1:]);ck(direc!=opp[d],f'{id} snake immediate reverse','exact-simulation')
  d=direc
  for _ in range(n):
   dx,dy=D[d];new=(b[0][0]+dx,b[0][1]+dy);grows=bool(fruits and new==fruits[0])
   ck(0<=new[0]<18 and 0<=new[1]<18 and new not in bad and new not in (b if grows else b[:-1]),f'{id} snake collision at {new}','exact-simulation')
   if not (0<=new[0]<18 and 0<=new[1]<18 and new not in bad):return
   b=[new]+(b if grows else b[:-1]);
   if grows:fruits.pop(0)
 ck(not fruits,f'{id} snake incomplete {fruits}','exact-simulation')
 ck(len(b)==3+len(c['fruitQueue']),f'{id} snake growth mismatch','exact-simulation')

if __name__=='__main__':
 each()
 print('Content pack:',len(GAMES),'games,',len(GAMES)*6,'stages')
 for k,v in sorted(checks.items()):print(f'  {k}: {v} assertions')
 if errors:
  print('FAILED',len(errors))
  for err in errors:print(' -',err)
  sys.exit(1)
 print('PASS: content contract and reference checks. NOT an original-engine physics or mobile playtest.')
