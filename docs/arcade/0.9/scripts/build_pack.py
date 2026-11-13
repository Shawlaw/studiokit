from pathlib import Path
import json, math, collections, copy, itertools, textwrap
ROOT=Path(__file__).resolve().parent.parent
LEV=ROOT/'levels'; LEV.mkdir(exist_ok=True)
all_games={}
meta={
 'shadow-leap':('影跃','shadow-leap.html','影之试炼','平台动作/探索'),
 'snowbells':('雪铃','snowbells.html','雪夜演奏','路径节奏/连击'),
 'star-raid':('星海突击','star-raid.html','星域战术','弹幕识别/攻防'),
 'pendulum-tower':('层塔','pendulum-tower.html','建筑委托','物理预测/结构'),
 'block-drop':('俄罗斯方块','block-drop.html','残局工坊','旋转布局/空间推演'),
 'road-rush':('极速车道','road-rush.html','路书挑战','车流预测/路线'),
 'gold-miner':('黄金矿工','gold-miner.html','矿脉委托','时间规划/角度'),
 'brick-breaker':('砖块计划','brick-breaker.html','弹道研究所','控角/优先级'),
 'gravity-flip':('重力翻转','gravity-flip.html','重力走廊','时机/预判'),
 'snake-run':('贪吃蛇','snake-run.html','果园迷阵','地图规划/空间'),
 'mole-whack':('打地鼠','mole-whack.html','洞口节奏','识别/资源分配'),
 'memory-flip':('记忆翻牌','memory-flip.html','线索试炼','编码/排除推理'),
 'merge-2048':('2048 合成','merge-2048.html','数字残局','多步推演/布局'),
}

def make(game,i,title,goal,decision,tech,discovery,content,witness,tests,seconds=(45,120),difficulty=None,notes='',feature=[]):
    d={'schemaVersion':'1.0.0','id':f'{game}-C{i:02d}','gameId':game,'stageNumber':i,'chapter':meta[game][2], 'title':title, 'difficulty': difficulty or i, 'targetDurationSec':list(seconds), 'goalStatement':goal,'decision':decision,'practicedSkill':tech,'discovery':discovery,'mode':'challenge','content':content,'referencePlan':witness,'acceptance':{'success':tests[0],'failure':tests[1],'mobile':tests[2], 'afk':'任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续'}, 'integration':{'separateClassicProgress':True, 'noAssistedRequired':True, 'requiredFeatures':feature, 'adaptToHead':True},'designerNotes': notes}
    all_games.setdefault(game,[]).append(d)
    return d

def platform(id,x,h,w=100,kind='static',**kw):
    return dict(id=id,xCenter=x,height=h,width=w,kind=kind,**kw)

shadow=[
('初入影林','抵达高度402的影门','走中路稳妥通关或偏右获取卷轴','观察惯性并提前对准落点','右侧银树标记提示有可选卷轴',[
 platform('p0',210,0,120),platform('p1',184,70,110),platform('p2',228,142,96),platform('p3',183,214,106),platform('p4',236,286,98),platform('p5',205,358,110),platform('secret',326,203,70)],['p0','p1','p2','p3','p4','p5'],['p2','secret','p4'],402,'none','side-scroll', '不使用影冲也可完成；偏右卷轴不参与通关'),
('月下断桥','通过移动桥与易碎桥后抵达影门','移动桥短路 vs 宽静态平台绕行','等待移动相位，易碎平台起跳前预留方向','两条路径不同步且都能到终点',[
 platform('p0',205,0,120),platform('p1',171,72,103, 'moving',amplitude=18, periodSec=3.0,phase=0),platform('p2',267,146,85,'fragile',breakDelaySec=.65),platform('p3',239,219,94,'moving',amplitude=22,periodSec=2.6,phase=1.57),platform('p4',165,291,100),platform('p5',214,363,105),platform('q2',92,149,93),platform('q3',106,221,95)],['p0','p1','p2','p3','p4','p5'],['p1','q2','q3','p4'],405,'none','fork','易碎平台在脚下有0.65秒醒目裂纹提示，不能无预警坍塌'),
('影冲试炼','用至少一次影冲越过月蚀裂隙','保留影冲以越过横向大缺口；卷轴奖励需额外精度','起跳后蓄势，空中定向影冲，落地刷新','左端石碑明确标示冲刺仅落地恢复',[
 platform('p0',110,0,118),platform('p1',66,78,76),platform('p2',365,155,76),platform('p3',285,234,99),platform('p4',191,310,103),platform('p5',225,386,98),platform('secret',349,264,66)],['p0','p1','p2','p3','p4','p5'],['p2','secret','p3'],428,'dash','gap','平台 p1→p2 需以真实轨迹证明无影冲不可达、有影冲可达；若达不到，必须调整间距并保留测试'),
('风之回廊','在两段风口中抵达高门','逆风短路要精确影冲，背风外圈更稳定','提前看风向旗、对冲时机作选择','壁画揭示风向每次固定，不做随机风',[
 platform('p0',202,0,119),platform('p1',253,76,105),platform('p2',322,152,86,'moving',amplitude=14,periodSec=3.2,phase=0),platform('p3',244,230,92),platform('p4',159,309,100),platform('p5',220,390,102),platform('q2',170,151,92),platform('q3',135,231,98)],['p0','p1','p2','p3','p4','p5'],['p1','q2','q3','p4'],431,'dash','wind','风区域 height=[115,225] 加速度按 x 方向±65px/s²；风矢量始终可视'),
('双影岔路','任选一条主路线抵达分岔山门','右侧影冲捷径节省两跳；左侧宽平台收集线索','读地图构图决定风险与步数','在左下角的发光纹样发现门钥匙线索',[
 platform('p0',205,0,120),platform('p1',182,77,100),platform('l2',102,153,98),platform('l3',121,229,94),platform('l4',179,305,99),platform('r2',357,153,78),platform('r3',336,231,78,'fragile',breakDelaySec=.7),platform('r4',293,307,86),platform('p5',239,382,102),platform('secret',92,273,72)],['p0','p1','l2','l3','l4','p5'],['p1','r2','r3','r4','p5'],425,'dash','fork','影冲短路与主线都能通关；卷轴仅影响收藏记录，不影响解锁'),
('月门守卫','集齐两座房间开关后抵达最终影门','先左开关还是右开关自由，回中央安全平台调整','连续预判相位、冲刺与保留检查点','两个半月雕像需要被亲自触碰，不能隔空触发',[
 platform('p0',210,0,120),platform('p1',210,82,105),platform('left-switch',95,157,94,'moving',amplitude=13,periodSec=3.4,phase=0),platform('right-switch',326,159,96,'moving',amplitude=13,periodSec=3.4,phase=3.14),platform('center',210,233,119),platform('upper',253,312,95,'fragile',breakDelaySec=.8),platform('p6',210,390,115)],['p0','p1','left-switch','center','right-switch','center','upper','p6'],['p1','right-switch','center','left-switch','center','upper','p6'],435,'dash','two-switch','开关触发顺序不限；回中心平台不会重置开关；死亡从房间检查点重试')
]
for i,(title,goal,dec,skill,disc,plats,main,alt,end,ability,kind,note) in enumerate(shadow,1):
  content={'coordinates':'420×740逻辑像素；平台 xCenter 与 height 均为世界坐标；height=0为出发平台，向上为正；禁止按屏幕坐标硬编码','playerSpawn':{'platformId':'p0','offsetX':0},'platforms':plats,'mainRoute':main,'alternativeRoute':alt,'goal':{'type':'gate','xCenter':210 if i!=3 else 225,'height':end,'radius':38},'requiredAbility':ability,'stageRule':kind,'collectibles':[{'id':'scroll','platformId': 'secret', 'optional':True}] if any(p['id']=='secret' for p in plats) else [],'deathPolicy':'落出关卡边界后从最近房间检查点重试，关卡任务不回退'}
  if i==4: content['winds']=[{'heightFrom':110,'heightTo':230,'forceX':-65,'telegraph':'旗子+粒子'}]
  if i==6:content['switches']=[{'platformId':'left-switch','persistentWithinAttempt':True},{'platformId':'right-switch','persistentWithinAttempt':True}]; content['goal']['unlock']='all-switches'
  make('shadow-leap',i,title,goal,dec,skill,disc,content,{'main':main,'optional':alt,'tactics':note},[f'主路径 {main} 能在允许动作集下连贯落地并触发出口','无影冲前两关必须可解；S3 起必需动作与奖励路线独立；死亡返回关内检查点','左右持续按压与影冲按钮支持两指并发，屏幕边缘影冲按钮≥44CSS px'],(45,155),notes=note,feature=['challenge_mode','stage_gate','air_dash'] if i>=3 else ['challenge_mode','stage_gate'])

snow=[
('四铃开场',['A','B','C','D'], [('A',210,0,'normal'),('B',174,77,'normal'),('C',239,150,'normal'),('D',201,224,'normal')], 'A→B→C→D，四铃顺序击中即可收局','分辨下一颗正确铃，不盲目追最近一颗','连续命中 4 次并学会提前转向','最后一颗铃带有不同音色'),
('左右对唱',['A','B','C','D','E'], [('A',204,0,'normal'),('B',125,71,'normal'),('C',260,145,'normal'),('D',132,220,'normal'),('E',231,295,'normal')],'按左右交替的音序 A→E','错误路径仍可救回，但会丢失完美连击','先预判下一跳的横向跨度','正确音序投射在背景星线'),
('休止与连奏',['A','B','C','D','E'], [('A',212,0,'normal'),('B',171,76,'rest'),('C',258,150,'normal'),('D',189,229,'rest'),('E',222,305,'normal')],'经过两个休止铃后完成 3 音连奏','休止铃负责反弹但不计入连击；绕开会掉落','理解节奏中的非计分落点','休止铃声音更轻且形状有空心标记'),
('双线谱',['A','B','C','D','E','F'], [('A',210,0,'normal'),('B',144,76,'normal'),('C',248,151,'normal'),('D',143,229,'normal'),('E',248,304,'normal'),('F',214,378,'normal'),('q1',318,214,'bonus'),('q2',318,291,'bonus')],'主音六连击通关，右侧两枚彩铃为可选高分路线','选择主线稳连或切入彩铃再汇合','同一次反弹规划连续两个目标','彩铃路线有肉眼可辨的渐亮轨迹'),
('冷暖和声',['A','B','C','D','E','F'], [('A',210,0,'normal'),('B',160,72,'blue'),('C',246,148,'red'),('D',160,223,'blue'),('E',246,300,'red'),('F',208,377,'normal')],'按蓝红交替序列完成六铃','选错颜色不立刻死，但本关完美评价失败','观察颜色同时依赖形状文字标志识别','颜色与图形同时编码，不能只靠颜色'),
('雪夜终曲',['A','B','C','D','E','F','G'], [('A',206,0,'normal'),('B',146,74,'normal'),('C',259,150,'normal'),('D',209,224,'rest'),('E',145,296,'blue'),('F',267,370,'red'),('G',210,445,'normal'),('q1',325,297,'bonus')],'在一次演奏里完成七节点序列并收尾','彩铃捷径与稳妥七连，高手争取无断连','综合颜色辨认、休止衔接、落点控制','终曲完美连击触发仅视觉性的隐藏雪花乐谱')]
for i,(title,seq,raw,goal,dec,skill,disc) in enumerate(snow,1):
  bells=[{'id':bid,'xCenter':x,'height':h,'kind':k,'radius':9,'consumable':True} for bid,x,h,k in raw]
  normal=[b for b in bells if b['id'] in seq]
  content={'coordinates':'420x740；bell.height相对起点向上；每次命中刷新向上初速 -655，最大理论上升159，实际还需验证横向可达','bells':bells,'requiredSequence':seq,'completion':'按顺序命中指定铃铛，休止铃只反弹不加连击，不强制收集bonus','wrongBellPolicy':'可反弹但不给计分；0.8s内显示下一个正确目标','comboBreakPolicy':'落空/错序会失去本关完美奖励，普通通关可恢复继续','startBell':'A','goalAfterLast':True}
  make('snowbells',i,title,goal,dec,skill,disc,content,{'bellOrder':seq,'optional': [b['id'] for b in bells if b['kind']=='bonus'], 'tactics':'命中后先看下一个目标再进行横移，不依赖局内道具'},['指定铃铛间距和弹跳时间允许物理命中且不可重复计分','无道具可完成必经序列；休止铃能弹但不计分','显示下一个目标，左右多指操作无粘滞'],(45,140),notes='请使用确定性铃点图；连击只统计首次正确命中。',feature=['stage_bell_sequence'])

bricks=[
('中路开门',['..1111..','.111111.','111..111','111..111','........'], '使球从中央缺口穿入顶部，消除所有砖','球正中打挡板 vs 偏心打挡板','掌握击球位置对角度的影响','观察中间两列形成天然反弹通路',None),
('左右回廊',['11....11','11....11','11....11','11111111','........'], '清空护城左右两组砖','先左边开槽或右边开槽','连续接球后设定斜入侧翼角','开口让球沿侧墙循环敲砖',None),
('双钥匙门',['..1KK1..','.11GG11.','111GG111','........','........'], '击毁两把钥匙砖 K，才能打破门砖 G','先击左钥匙或右钥匙','反弹角度定向瞄准','钥匙变亮预告关联门的开启',{'K':'全部 K 击毁后所有 G 从不可破坏障碍变为普通1HP砖'}),
('镜像迷阵',['111..111','1.2..2.1','1.1..1.1','..1111..','........'], '通过墙面回弹清理两侧高 HP 砖','正面多次弹击或寻找侧边撞击角','预测至少一次墙体反弹','发现外侧两条球路回弹会先打侧砖',None),
('薄壁防线',['..3333..','..1111..','.11..11.','11....11','........'], '穿透低层薄壁，再清顶部重砖','先打通正中还是清两边','利用上方连续反弹提高每次控球收益','高层 HP=3 的可见裂纹演变',None),
('研究所终试',['K.2..2.K','GG1..1GG','.11..11.','11111111','........'], '先点亮两把钥匙、开启两侧门并清理所有可破坏砖','两钥匙顺序可互换，求最少击球次数','综合侧墙、挡板偏心与多击砖','左右两侧都可成为加速清场入口',{'K':'两把钥匙都击毁后开启全部 G；此前 G 只作硬墙不计待消除'})]
for i,(title,rows,goal,dec,skill,disc,rule) in enumerate(bricks,1):
  content={'coordinates':'8列×5行，左上为(0,0)，砖坐标 x=20+col*48, y=128+row*24；.为空','brickRows':rows,'tokenLegend':{'.':'empty','1':'1HP','2':'2HP','3':'3HP','K':'1HP trigger brick','G':'locked gate brick; initially invulnerable'},'mechanics':rule or {},'ball':{'speed':285+8*(i-1),'startingPaddleX':210,'paddleWidth':88 if i<=3 else 82,'lives':3},'win':{'type':'destroy_all_breakable_including_unlocked_gates'},'stuckBallRecovery':{'ifNoBrickContactSec':12,'action':'给反弹方向微调且展示提示，不扣命；首次试图只提示'}}
  make('brick-breaker',i,title,goal,dec,skill,disc,content,{'route':'先按推荐开口控角引导至上方，随后清理残砖','hint':disc},['固定砖阵加载后每颗砖的 HP/机关状态与图一致','通关必须全部可破坏砖归零；球不可永久卡死；机关解锁状态可恢复','挡板可单指拖动，手指不遮挡接球判定'],(75,180),notes='K/G 属 challenge 独立机制；经典关卡原生 spawnBricks 不动',feature=['fixed_brick_layout']+(['gate_brick'] if rule else []))

flips=[
('第一次翻转',[(520,'floor',145),(1050,'ceiling',145),(1570,'floor',145)],[(250,'ceiling'),(790,'floor'),(1310,'ceiling')],[], '认识两次翻转动作的竖向抵达时间','至少提前350逻辑距离看到下一障碍'),
('双连拍',[(480,'floor',160),(890,'floor',160),(1430,'ceiling',165),(1880,'ceiling',165)],[(220,'ceiling'),(1100,'floor')],[(1200,210)],'连续同侧障碍不应机械连续翻转','空中停留在安全天花板也是策略'),
('上下合奏',[(520,'floor',162),(1050,'ceiling',162),(1590,'floor',170),(2130,'ceiling',170)],[(230,'ceiling'),(740,'floor'),(1280,'ceiling'),(1830,'floor')],[(1380,180)],'逐个观察交错障碍决定切换时间','提前把路线留在另一侧而非临门一脚'),
('星之岔路',[(500,'floor',170),(1030,'ceiling',170),(1550,'floor',170),(2070,'ceiling',175)],[(220,'ceiling'),(730,'floor'),(1260,'ceiling'),(1800,'floor')],[(850,245),(1390,410)],'两颗星在中层，需要短暂翻转后再回归安全路线','奖励是冒险而非必经'),
('双窄门',[(490,'floor',190),(990,'ceiling',190),(1510,'floor',205),(2050,'ceiling',205)],[(210,'ceiling'),(690,'floor'),(1220,'ceiling'),(1740,'floor')],[], '障碍高度明显增加但预告更早','练习观察到行动的稳定延迟'),
('重力终章',[(500,'floor',155),(940,'ceiling',165),(1370,'floor',165),(1810,'ceiling',185),(2260,'floor',195)],[(210,'ceiling'),(650,'floor'),(1090,'ceiling'),(1520,'floor'),(1960,'ceiling')],[(730,270),(1600,380)],'交错障碍+一次中间奖励路线选择','目标是完成清晰的动作序列，不靠纯随机')]
for i,(title,obs,flps,coins,tech,disc) in enumerate(flips,1):
 content={'coordinates':'世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset','distanceToFinish':max(2200,obs[-1][0]+270),'scrollSpeedPxSec':260,'gravity':2100,'obstacles':[{'id':f'o{k}','x':x,'side':side,'height':h,'width':42,'telegraphLeadPx':360} for k,(x,side,h) in enumerate(obs,1)],'recommendedFlipWindows':[{'xCenter':x,'toward':to,'tolerancePx':70} for x,to in flps], 'bonusStars':[{'x':x,'y':y,'required':False} for x,y in coins],'startGravity':'floor','win':'pass finish marker alive','collision':'lives=2; collision respawn at most recent safe segment, no auto-use shield'}
 make('gravity-flip',i,title,'从起点通过全部固定尖刺并抵达终点','先保持当前安全侧还是提前翻转',tech,disc,content,{'flipWindows':flps,'skill':tech},['物理仿真至少存在一条可无伤通过的翻转时间序列，角度窗口允许手机响应','在无道具前提下可通过；任一尖刺须满足可观察反应窗口','整个画布点击与空格一致，停顿后不会误触翻转'],(45,115),notes='推荐翻转点是待物理验证的设计初值，不可把列表直接当成无碰撞证明',feature=['fixed_obstacle_sequence'])

# write first 4 games
for g in ('shadow-leap','snowbells','brick-breaker','gravity-flip'):
 (LEV/(g+'.json')).write_text(json.dumps({'gameId':g,'gameName':meta[g][0],'sourceFile':meta[g][1],'stages':all_games[g]},ensure_ascii=False,indent=2)+'\n')
print('PART1',len(all_games),sum(map(len,all_games.values())))

# 星海突击：每关逐秒事件脚本，敌机出现前向玩家告知预警与安全通道
star=[
('护航第一课',35,[(3,'scout',.22,'single',.64),(8,'scout',.78,'single',.20),(14,'pair',.5,'fan3',.05),(21,'scout',.2,'aimed',.75),(27,'pair',.64,'fan3',.15)],[(16,'spread',.8)],'观察三发扇弹留下的通道','安全走位和清怪都能达成任务','击落全部目标/撑到结束标记'),
('扫射之门',42,[(3,'sweeper',.25,'sweep-lr',.80),(10,'scout',.8,'aimed',.10),(18,'sweeper',.75,'sweep-rl',.12),(27,'pair',.48,'fan3',.08),(34,'sweeper',.3,'sweep-lr',.82)],[(18,'laser',.5)],'认清连续扫射方向并先移动到安全侧','拿激光需穿越中央区域，非必需','通过五段标记扫射'),
('冲锋预警',46,[(4,'charger',.25,'mark-charge',.75),(12,'charger',.75,'mark-charge',.25),(20,'pair',.52,'fan5',.10),(29,'charger',.5,'mark-charge',.85),(38,'scout',.7,'aimed',.15)],[(22,'homing',.7)],'先观察冲锋目标线，预警结束才移动','冲锋失败时要知道自己是否在预警区域','无碰撞完成冲锋训练'),
('拾取抉择',48,[(4,'pair',.38,'fan3',.87),(11,'sweeper',.76,'sweep-rl',.1),(19,'pair',.44,'fan5',.15),(28,'charger',.24,'mark-charge',.75),(37,'sweeper',.5,'sweep-lr',.9)],[(9,'rapid',.8),(30,'laser',.2)],'危险边缘的拾取物与安全通路形成不同收益','不拾取也可完成，拾取可提高局内评价','无道具存活并通过结束门'),
('护盾与弱点',55,[(4,'scout',.32,'aimed',.85),(11,'pair',.6,'fan5',.10),(19,'sweeper',.28,'sweep-lr',.8),(27,'charger',.74,'mark-charge',.18),(37,'boss',.5,'weak-left-right',.15)],[(23,'spread',.75)],'Boss 左右暴露弱点，阶段间有喘息','判断是否先清小敌还是抢 Boss 输出窗口','击败双弱点 Boss'),
('星域毕业战',65,[(3,'sweeper',.25,'sweep-lr',.85),(9,'charger',.78,'mark-charge',.20),(16,'pair',.5,'fan5',.10),(25,'sweeper',.76,'sweep-rl',.15),(34,'charger',.28,'mark-charge',.8),(44,'boss',.5,'phase-sweep-and-core',.10)],[(18,'laser',.8),(40,'homing',.2)],'先躲确定性弹幕再利用核心暴露窗口','Boss 第二阶段发射扇弹时安全带移动','击败两阶段 Boss')]
for i,(title,dur,raw,pick,skill,disc,goal) in enumerate(star,1):
 ev=[]
 for k,(t,typ,x,pat,safe) in enumerate(raw,1):
  ev.append({'id':f'w{k}','atSec':t,'enemyType':typ,'spawnXRatio':x,'attackPattern':pat,'telegraphSec':1.4 if typ=='charger' else (1.25 if typ=='boss' else .9),'safeBandXRatio':{'center':safe,'halfWidth':.12},'attackActiveSec':3.4 if typ!='boss' else 16,'stopNewThreatsUntilSec':t+2.2})
 content={'stageDurationSec':dur,'playerSpawn':{'xRatio':.5,'yRatio':.85},'startingHealth':3,'events':ev,'powerups':[{'atSec':t,'kind':k,'xRatio':x,'required':False} for t,k,x in pick],'endCondition':('defeat-boss' if any(e['enemyType']=='boss' for e in ev) else 'survive-and-clear-events'),'patternContract':{'single':'向下单发，瞄准当前位置后锁定','aimed':'预警瞄准后单发','fan3':'三个固定发散角-22/0/+22度','fan5':'五个固定发散角-32/-16/0/+16/+32度','sweep-lr':'左向右扫描危险带，预先显示扫线','sweep-rl':'右向左扫描危险带，预先显示扫线','mark-charge':'标线1.4秒后沿直线冲锋，标线期间锁定落点','weak-left-right':'先左翼2.5s后右翼2.5s，重复至弱点耗尽','phase-sweep-and-core':'第1阶段扫线，第2阶段中央核心暴露3s，循环'},'bulletSafeSpace':'所有攻击段至少保留一条玩家可达≥56逻辑px宽的安全走廊，待模拟验证'}
 make('star-raid',i,title,goal,'继续待在安全带还是穿越危险区取武器',skill,disc,content,{'events':[e['id'] for e in ev], 'plan':'读取预警线，移向 safeBandXRatio，Boss 露弱点后再进攻'},['定时事件不依赖Math.random且预警与伤害开始时间可复测','弹幕演算留出可达安全区；阶段目标可在基础武器下完成','按住拖动+技能点击两指并发，子弹/弱点在小屏可辨'],(dur,dur+35),feature=['fixed_wave_timeline']+(['boss_phase_script'] if i>=5 else []))

# 层塔：所有块中心偏移相对于基座中心210px；强调设计目标，不把预设落点冒称物理自动通关
stacks=[
('稳稳四层',[0,0,0,0],[0,0,0,0],.075,4,'校准中心，完成4层','中心更稳，偏离可获得更快释放但损失稳定度','学习钟摆过中心的时刻','完美层数可作为独立目标'),
('交替施工',[-8,8,-8,8],[-8,8,-8,8],.09,4,'按左右交替标记完成4层','标记位置与重心的权衡','小幅偏心的释放时机','观察箱体偏移能否互相抵消'),
('偏右的委托',[5,10,-4,-10,0],[5,10,-4,-10,0],.11,5,'前两层右偏，后两层向左矫正','优先贴标记还是先修正中心','连续两次偏置后的重心修复','从重心可视化读出倾斜的累积'),
('有限配重',[-12,-8,6,10,2],[-12,-8,6,10,2],.11,5,'5层达到目标且配重最多用1次','何时保留配重机会','预测下一层是否值得修正','对比用/不用配重的结构差异'),
('窄层挑战',[0,12,-10,8,-8,0],[0,12,-10,8,-8,0],.095,6,'六层且连续三层无大偏差','更慢找中心还是拿较小的时间收益','追踪稳定区宽度随楼层变化','发现摆动速度不是唯一难度来源'),
('城市小塔',[-8,8,-12,10,-6,3],[ -8,8,-12,10,-6,3],.115,6,'综合六层，并保持塔顶中心距基座≤15px','两种可行箱序的风险收益','交替偏置、修正和有限容错','结束时展示结构剖面与偏移走势图')]
for i,(title,marks,reference,maxlean,count,goal,dec,skill,disc) in enumerate(stacks,1):
 content={'coordinates':'420x740；每箱宽64高40，baseCenterX=210；targetOffsetsPx 是箱心相对基座中心的目标偏置，允许±8px','baseCenterX':210,'boxes':[{'order':j+1,'width':64,'height':40,'targetOffsetPx':v,'tolerancePx':8 if i<5 else 7} for j,v in enumerate(marks)],'pendulum':{'pivotX':210,'pivotY':64,'length':135,'speedFactor':round(1+.06*(i-1),2),'deterministicStartPhaseRad':0},'limits':{'maxTowerLeanAbs':maxlean,'maxDroppedBoxes':count+1,'braceUsesAllowed':1 if i==4 else 0,'guideUsesAllowed':0},'win':{'floorsAtLeast':count,'noCollapse':True,'allMarkTargetsWithinTolerance':False},'evaluation':{'bronze':'完成并保持稳定','silver':'全部偏置目标±8px内','gold':'满足银牌且零道具、零失误'},'physicsNote':'本配置仅规定目标/条件；实际放置是否稳定必须在当前 Lean 模型中按帧仿真'}
 make('pendulum-tower',i,title,goal,dec,skill,disc,content,{'releaseOffsetsPx':reference,'strategy':'按目标标记释放，偏置纠正后再看重心指示'},['物理模拟能以一组真实释放时机稳定完成目标楼层','超出倾斜极限判倒塔，配重上限按关卡校验','放箱是清晰的独立点击，底部按钮不遮住钟摆轨迹'],(60,170),notes='禁止运行时强行吸附到targetOffset；mark 是目标提示，真实释放与物理判定必须保留',feature=['commission_mode','fixed_marks'])

# 俄罗斯方块：底部棋盘字符串（.为无块，#为既有垃圾块）；定义固定方块队列与参考摆法
TetrisData=[
('第一道横井',{'19':'###....###'},['I'],[('I','H',3)],1,'用横向 I 填平一行','横向 I 一次清行；不要空场堆叠','横井的宽度等于4格'),
('双行方井',{'18':'####..####','19':'####..####'},['O'],[('O','N',4)],2,'用 O 一次清两行','精确移动到中央两格','理解O方块落在连续2×2空间'),
('纵井四消',{'16':'#####.####','17':'#####.####','18':'#####.####','19':'#####.####'},['I'],[('I','V',5)],4,'用竖直 I 清四行','需要旋转 I 而非横放','知道Tetris四消的井的开法'),
('两次横修',{'18':'###....###','19':'###....###'},['I','I'],[('I','H',3),('I','H',3)],2,'两个 I 逐层修复横井','先放下层，再补新掉落的一层','消行后重力会让上层自然下落'),
('T形锁孔',{'18':'####...###','19':'#####.####'},['T'],[('T','STEM-DOWN',4)],2,'T形正确方向放入非矩形锁孔','左右平移与旋转要配合','读懂不规则凹槽而非盲目直落'),
('复合工坊',{'16':'#..#######','17':'#..#######','18':'####...###','19':'#####.####'},['O','T'],[('O','N',1),('T','STEM-DOWN',4)],4,'先 O 后 T，完成连续四行清除','若先考虑下方T，会被上方方井阻挡','清除顺序就是核心解题空间')]
for i,(title,rows,queue,sol,nlines,goal,skill,disc) in enumerate(TetrisData,1):
 board=['..........']*20
 for k,v in rows.items():board[int(k)]=v
 content={'boardWidth':10,'boardHeight':20,'boardTopToBottom':board,'pieceQueue':queue,'holdEnabled':False,'gravityMode':'place-by-place with no time pressure, hard drop + rotate','spawnPolicy':'only fixed pieceQueue; no bag-7 randomness','initialActivePiece':queue[0],'win':{'type':'clear-lines','count':nlines,'maxPlacedPieces':len(queue)},'lose':{'type':'queue-exhausted-or-top-out','ifGoalUnmet':True},'pieceDefinitions':{'I-H':[[0,0],[1,0],[2,0],[3,0]],'I-V':[[0,0],[0,1],[0,2],[0,3]],'O-N':[[0,0],[1,0],[0,1],[1,1]],'T-STEM-DOWN':[[0,0],[1,0],[2,0],[1,1]]},'coordinates':'reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.'}
 plan=[{'piece':p,'orientation':o,'leftCol':x,'action':'rotate/place/hardDrop'} for p,o,x in sol]
 make('block-drop',i,title,goal,'选择摆放方向和顺序（挑战模式固定出块）',skill,disc,content,plan,['按参考队列执行能在最大置块数内清行并达标','提前耗尽队列而未达标应失败，且经典7-bag绝不改动','左右/旋转/硬降有独立触摸按钮，连续点击不会粘键'],(25,110),feature=['puzzle_board_preset','puzzle_piece_queue','clear_line_goal'])

# 极速车道：1秒1个决策时隙，障碍格固定；每关含一条移动≤1车道的连续安全证据
road_patterns=[
('入门超车',[[2],[2],[1],[1],[0],[0],[3],[3],[1],[1],[2],[2]],'识别阻挡车道并提前改变车道','慢车停留的车道一段时间保持不变','分数奖励安全超车而不是随机变道'),
('左右交替',[[1],[1,2],[2],[2,3],[3],[0],[0,1],[1],[1,2],[2],[1,2],[3]],'交错车流中识别下一秒的安全区域','贴近拥堵时可以选择暂留安全车道','看预告比最后时刻换道更好'),
('施工收窄',[[3],[2,3],[2,3],[1,3],[1,2],[1,2],[0,2],[0,1],[0,1],[0],[3],[3]],'提前避开占据两个车道的施工路段','中途选择左绕还是右绕','施工障碍不应瞬间刷新'),
('车队夹缝',[[0,3],[0,3],[1,3],[1,3],[0,2],[0,2],[0,3],[1,3],[1,3],[2,3],[2,3],[0,3]],'以两车道内的安全空间连续变道','放弃贴身超车奖励或挑战高分','优先看未来两个位置而不是当前空挡'),
('近距奖励',[[0],[0,2],[2],[1,2],[1],[1,3],[3],[2,3],[2],[0,2],[0],[0,1]],'在保命路线之外选择近车道超车积分','拥堵车道额外加分但不强迫冒险','看懂奖励门牌并在恰当时刻避开'),
('最终路书',[[0,3],[0,3],[1,3],[1,2],[0,2],[0,2],[1,3],[1,3],[0,2],[0,2],[1,3],[1,3],[0,2],[0,2]],'持续读出拥堵变化，抵达最后路标','先作安全变道规划，再考虑高分贴近车流','将前五关的选择合并为连续动作')]
def road_path(blocks, start=1):
 paths={start:[start]}
 for bad in blocks:
  nxt={}
  for l,path in paths.items():
   for cand in [l,l-1,l+1]:
    if 0<=cand<=3 and cand not in bad and (cand not in nxt or len(set(path+[cand]))>len(set(nxt[cand]))):nxt[cand]=path+[cand]
  paths=nxt
  if not paths:return None
 return min(paths.values(),key=lambda p:sum(p[i]!=p[i+1] for i in range(len(p)-1)))
for i,(title,blocked,goal,skill,disc) in enumerate(road_patterns,1):
 witness=road_path(blocked)
 content={'laneCount':4,'slotDurationSec':1.15 if i<4 else 1.05,'laneChangeTimeSec':.22,'startLane':1,'timeline':[{'slot':k,'atSec':round((k-1)*(1.15 if i<4 else 1.05),2),'occupiedLanes':b,'telegraphLeadSec':1.5,'optionalNearPassBonusLanes':[l for l in range(4) if l not in b and any(abs(l-o)==1 for o in b)]} for k,b in enumerate(blocked,1)],'goal':{'type':'survive-all-slots','minDistanceMeters':400+i*140},'scoreRules':{'passBonus':10,'nearPassBonus':5,'noDamageGold':True},'spawnerPolicy':'challenge only; disable classic random spawn while timeline active','pathProofModel':'at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested'}
 make('road-rush',i,title,goal,'避让是硬目标，近距超车只增加评价',skill,disc,content,{'safeLaneBySlot':witness,'bonusStrategy':'不求最高分，只给出可活着完成的安全车道序列'},['时间展开DP存在连续相邻车道安全路径，并检查换道过渡0.22秒内的碰撞','把任一车阵改到无可行路径时校验器必须拒绝；碰撞有清晰责任归因','左右手势和按键一次恰好一车道，按住不重复跳道'],(20,75),notes='lane proof只按离散格成立；真正实现必须把相邻车道过渡也纳入碰撞测试',feature=['fixed_traffic_timeline','time_expanded_lane_validator'])

# 黄金矿工：使用当前源码 TYPES 实值，固定位置和参考抓取顺序
items_gold=[
('轻金快取',550,60,[('m1','goldM',154,360),('m2','goldM',265,350),('l1','goldL',216,525),('s1','goldS',330,550),('r1','rockS',105,570)],['m1','m2','l1'],'精准地选择三条不重合角度','分辨深处重金与近处轻金的回收时间'),
('钻石的代价',750,58,[('d1','diamond',340,470),('m1','goldM',98,450),('m2','goldM',215,400),('r1','rockL',290,590),('s1','goldS',145,580)],['d1','m1'],'先拿远钻石还是先拿近金块','比较价值和钩爪占用时间'),
('第一颗炸药',900,58,[('l1','goldL',110,520),('d1','diamond',310,450),('t1','tnt',245,415),('r1','rockS',174,370),('m1','goldM',360,590)],['l1','d1'],'避开中央炸药的优先路径','炸药对摆角构成可预判禁止区域'),
('双钻矿脉',1200,55,[('d1','diamond',104,440),('d2','diamond',318,475),('t1','tnt',225,340),('r1','rockL',290,560),('m1','goldM',145,600)],['d1','d2'],'两钻足够达标，但经过空角度需要等待摆动','不要贪近处低价值石块'),
('限时三钩',1000,52,[('d1','diamond',331,523),('l1','goldL',100,578),('m1','goldM',214,360),('t1','tnt',338,350),('r1','rockS',260,430)],['d1','l1','m1'],'规划三次抓取路线','抢近件还是等高值件的摆动相位'),
('矿工毕业考',1300,52,[('d1','diamond',115,600),('d2','diamond',318,600),('l1','goldL',210,476),('t1','tnt',346,350),('m1','goldM',75,425),('r1','rockL',340,450)],['d1','d2','l1'],'三次主抓在有限时间完成，炸药与石头是视觉干扰','综合重量、伸缩时间和角度等待')]
VALUES={'goldS':50,'goldM':150,'goldL':350,'diamond':600,'rockS':15,'rockL':20,'tnt':0}
WEIGHT={'goldS':2,'goldM':4,'goldL':8,'diamond':1.5,'rockS':9,'rockL':14,'tnt':0}
for i,(title,target,dur,raw,order,skill,disc) in enumerate(items_gold,1):
 items=[{'id':item_id,'type':typ,'x':x,'y':y,'value':VALUES[typ],'weight':WEIGHT[typ],'aimAngleDeg':round(math.degrees(math.atan2(x-210,y-104)),1)} for item_id,typ,x,y in raw]
 content={'coordinates':'420×740；钩爪轴(210,104)；item.xy为逻辑像素；角度为 atan2(x-210,y-104) 角度，向右为正；禁止自动随机重排','timeLimitSec':dur,'targetMoney':target,'items':items,'referenceCatchOrder':order,'initialTools':{'aim':0,'winch':0,'time':0},'hook':{'pivot':[210,104],'extendSpeedPxSec':560,'baseRetractSpeed':'inherit engine','swing':'inherit engine but use deterministic phase at stage start'},'complete':'达标即可选择立即结算，不要求抓光','fail':'倒计时归零且未达标','hazards':'TNT碰到立即销毁本次抓取收益，损失时间；不直接结束全局游戏'}
 witness=[{'itemId':id,'angleDeg':next(v['aimAngleDeg'] for v in items if v['id']==id),'priority':k+1} for k,id in enumerate(order)]
 make('gold-miner',i,title,'在倒计时内取得至少$'+str(target),'选择短钩低价/长钩高价和炸药风险',skill,disc,content,witness,['参考物品总价值满足目标；接入原钩爪物理后需实测全部抓取+摆动等待≤时限','禁用道具仍存在可行路线；炸药碰撞与钩爪先后顺序必须确定','手机短按放钩、长按瞄准线不能冲突；道具点击不触发放钩'],(30,dur),notes='表内参考捕获只证明价值充足，不证明角度遮挡/物理时间可行；必须记录运行回放验证',feature=['fixed_item_layout','hook_time_simulator'])

for g in ('star-raid','pendulum-tower','block-drop','road-rush','gold-miner'):
 (LEV/(g+'.json')).write_text(json.dumps({'gameId':g,'gameName':meta[g][0],'sourceFile':meta[g][1],'stages':all_games[g]},ensure_ascii=False,indent=2)+'\n')
print('PART2',len(all_games),sum(map(len,all_games.values())))

# 贪吃蛇：18x18稳定地图，固定水果顺序；参考路线由逐帧蛇身 BFS 算出（不是抽象曼哈顿路径）
snake_levels=[
('果园初识',[(x,11) for x in range(3,15) if x!=8],[(7,3),(9,6),(8,10)],'读懂长度、转弯和正向移动','保持出路，不要向自身尾部硬反转','安全区有明显回环空间'),
('中央小门',[(8,y) for y in range(2,14) if y!=7],[(6,5),(10,7),(12,11),(4,13)],'选择跨墙缺口，而不是贴墙盲走','提前把蛇头朝向门口','找到中央唯一可通过缺口'),
('双柱回廊',[(6,y) for y in range(3,13) if y not in (6,10)]+[(11,y) for y in range(3,13) if y not in (6,10)],[(4,6),(8,6),(13,10),(14,13)],'先观察柱子的出入口','用转向序列穿过狭窄走廊','上门/下门构成不同路线'),
('环形果园',[(x,4) for x in range(4,14) if x!=8]+[(x,13) for x in range(4,14)]+[(4,y) for y in range(5,13)]+[(13,y) for y in range(5,13) if y!=9],[(7,3),(10,7),(15,9),(8,15)],'从两个门往返内外环','绕行不等于坏选择，保护回头空间','门分布构成内外两种通道'),
('折叠花田',[(x,6) for x in range(2,15) if x!=4]+[(x,10) for x in range(2,15) if x!=13]+[(x,14) for x in range(2,15) if x!=5],[(2,4),(6,8),(14,12),(8,16)],'S形通道让简单贪心失效','每次取果前规划一个出口','不同缺口可以避免被封死'),
('迷阵终局',[(5,y) for y in range(3,16) if y!=6]+[(9,y) for y in range(2,15) if y!=11]+[(13,y) for y in range(3,16) if y!=8],[(4,5),(8,6),(12,11),(15,14),(3,15)],'在多门迷宫中兼顾蛇身变长','长蛇完成后几次转弯的安全距离','记住门的位置减少无效绕行')]
DIRS=[('R',(1,0)),('D',(0,1)),('L',(-1,0)),('U',(0,-1))]
OPP={'R':'L','L':'R','U':'D','D':'U'}
def snake_route(start,heading,obstacles,fruits):
 obs=set(map(tuple,obstacles));body=(tuple(start),(start[0]-1,start[1]),(start[0]-2,start[1])); hd=heading
 allsteps=[]
 for target in fruits:
  q=collections.deque([(body,hd,[])])
  seen={(body,hd)};found=None
  while q:
   b,last,steps=q.popleft()
   if b[0]==tuple(target): found=(b,last,steps);break
   for d,(dx,dy) in DIRS:
    if d==OPP[last]:continue
    nx,ny=b[0][0]+dx,b[0][1]+dy
    if not (0<=nx<18 and 0<=ny<18) or (nx,ny) in obs:continue
    grow=(nx,ny)==tuple(target)
    bodyblock=b if grow else b[:-1]
    if (nx,ny) in bodyblock:continue
    nb=((nx,ny),)+tuple(b if grow else b[:-1])
    key=(nb,d)
    if key in seen:continue
    seen.add(key);q.append((nb,d,steps+[d]))
  if found is None:return None
  body,hd,steps=found
  allsteps+=steps
 return allsteps

def rle_dirs(ds):
 return [f'{k}{len(list(g))}' for k,g in itertools.groupby(ds)]
for i,(title,obs,fruits,goal,skill,disc) in enumerate(snake_levels,1):
 route=snake_route((3,3),'R',obs,fruits)
 content={'grid':{'cols':18,'rows':18,'coords':'左上(0,0)，x向右，y向下'},'initialSnake':[[3,3],[2,3],[1,3]],'initialDirection':'R','walls':[list(x) for x in obs],'fruitQueue':[list(x) for x in fruits],'fruitSpawnMode':'scripted-once, only next fruit visible; never random','stepIntervalMs':230 if i<=3 else 200,'win':{'type':'collect-in-order','fruitCount':len(fruits)},'lose':{'type':'wall-or-body','lives':1},'turnBuffer':'最大队列2方向，按蛇每一逻辑步出队，拒绝反向180度','bonus':'在不碰任何障碍前提下减少总步数'}
 make('snake-run',i,title,goal,'绕路更安全还是尝试短路节省步数',skill,disc,content,{'movesRLE':rle_dirs(route) if route else [],'totalSteps':len(route) if route else None},['完整蛇身状态搜索能从开局按给定水果序列安全通关','若蛇身增长后堵死果实则必须修改地图/果实或增加提示，不能靠道具脱困','滑动方向按步缓存，连续两个90°输入都生效，反向自杀被拒绝'],(40,180),notes='BFS 参考路线只是可行路线，不保证步数最优；不要在UI中强行提示整条路线',feature=['fixed_snake_map','scripted_fruit_queue','direction_queue'])

# 打地鼠：固定时轴，槽位按3×3从左上到右下编号0..8；统一闪烁先兆并保留离线/暂停时钟
mole_events=[
('看准再敲',30,[(2,0,'normal'),(5,4,'normal'),(8,8,'normal'),(11,2,'normal'),(14,6,'normal'),(17,1,'normal'),(20,7,'normal'),(23,3,'normal')],6,0,'连续六次准确点击','观察鼠出现的窗口，而不是狂点屏幕','洞口闪动是可预测前摇'),
('金鼠优先',31,[(2,0,'normal'),(4.5,4,'gold'),(7,2,'normal'),(9.5,8,'gold'),(12,1,'normal'),(15,3,'normal'),(18,5,'gold'),(21,7,'normal'),(24,6,'normal')],7,2,'至少点中两只金鼠与五个普通目标','选择稀有高分目标优先','金鼠图案有星形边框而不只颜色不同'),
('识别炸弹',32,[(2,0,'normal'),(4,4,'bomb'),(6,8,'normal'),(8,2,'normal'),(10,6,'bomb'),(12,1,'gold'),(15,5,'normal'),(17,3,'bomb'),(19,7,'normal'),(22,4,'normal'),(25,0,'gold')],7,1,'至少七次正确敲击并避开所有炸弹','停止点击比击中目标同样重要','爆炸物有不同轮廓和出现前警告'),
('双目标节奏',34,[(2,0,'normal'),(4,4,'gold'),(4,8,'normal'),(7,1,'normal'),(7,7,'gold'),(10,2,'normal'),(10,6,'normal'),(13,0,'gold'),(13,8,'normal'),(16,3,'normal'),(16,5,'gold'),(20,4,'normal'),(23,2,'bomb')],8,2,'同时出现两只时优先点金鼠','两指各点击不同洞可节约时间','同一时刻多洞出现不构成无法完成的操作窗'),
('假象训练',34,[(2,0,'normal'),(4,1,'decoy'),(6,2,'gold'),(8,3,'normal'),(10,4,'bomb'),(12,5,'normal'),(14,6,'decoy'),(16,7,'gold'),(18,8,'normal'),(21,0,'normal'),(24,4,'gold')],7,2,'识别假目标，并在有限窗口稳定得分','放弃疑似陷阱，保留命中率','假目标不提供分数且打中扣一次评价'),
('洞口终考',38,[(2,0,'normal'),(4,4,'gold'),(4,8,'normal'),(7,1,'bomb'),(9,7,'normal'),(11,3,'gold'),(13,5,'normal'),(15,2,'decoy'),(17,6,'gold'),(19,4,'normal'),(21,0,'bomb'),(24,8,'normal'),(26,2,'normal'),(29,6,'gold'),(32,3,'normal')],10,3,'命中10个有效目标，其中金鼠≥3且零炸弹','分清优先级，比高频无脑点击更有效','终局综合金鼠、炸弹和假目标规律')]
for i,(title,dur,raw,minhits,mingold,goal,skill,disc) in enumerate(mole_events,1):
 ev=[{'id':f'e{k}','atSec':t,'slot':slot,'kind':kind,'prewarnSec':.42,'visibleSec':1.4 if i<4 else 1.25,'score':2 if kind=='gold' else (1 if kind=='normal' else 0)} for k,(t,slot,kind) in enumerate(raw,1)]
 content={'grid':{'rows':3,'cols':3,'slotOrder':'row-major from 0 to 8'},'stageDurationSec':dur,'events':ev,'win':{'minValidHits':minhits,'minGoldHits':mingold,'maxBombHits':0,'maxDecoyHits':1 if i>=5 else 0},'scoring':{'normal':1,'gold':2,'bomb':-3,'decoy':-1,'miss':0},'tapRule':'仅洞口可点击范围判定，每个事件最多命中一次','time':'使用暂停感知逻辑时钟；进入后台事件不推进'}
 chosen=[e['id'] for e in ev if e['kind'] in ('normal','gold')]
 make('mole-whack',i,title,goal,'敲有效目标或主动忽略炸弹/假目标',skill,disc,content,{'hitEventIds':chosen, 'ignoreKinds':['bomb','decoy']},['脚本全部有效目标数≥过关需求，spawn不重叠同一洞口时间窗','炸弹和假目标扣分正确且误触不会连击多次','两个同时有效目标可用双指点击，不被UI控件遮挡'],(dur,dur+10),feature=['scripted_spawn_wave'])

# 记忆翻牌：固定图案与线索，不把随机配对误判为有策略深度；需要独立“线索试炼”模式
memory_levels=[
('分区第一步',['A B C','A C B'],4.5,4,'仅看一次预览配对三组','按列建立位置记忆','观察相同符号不一定相邻',{}),
('两段扫描',['A B C D','C A D B'],3.8,4,'在4次错误以内配对四组','左半→右半顺序扫描降低遗忘','发现所有符号恰好一次分布在每行',{'hintText':'每种图案在上下两行各出现一次'}),
('位置线索',['A B C D','E F A B','F E D C'],4.0,5,'用分区预览与位置线索完成六对','先记每一行再用排除法','每对首张与末张的位置可以组成手势记忆',{'previewMode':'row-by-row','previewEachRowSec':1.5}),
('镜像试验',['A B C D','E F G H','D C B A','H G F E'],3.0,6,'识别上下两区域镜像配对规律','主动先观察规律，再翻牌','上下行是镜像排列',{'hintText':'上半区与下半区存在镜像关系'}),
('左右互换',['A B C D','E F G H','E G F H','B D A C'],3.0,5,'找出两层错位关系并完成八对','用象限编码而非死记整个棋盘','每对图案分散于上下两个半区',{'previewMode':'quadrants','previewEachQuadrantSec':1.4}),
('终局推理',['A B C D','E F G H','H A F C','D G B E'],2.8,4,'在更少的翻错次数内完成8对','建立逻辑笔记与优先检查顺序','有规律但不完全镜像，可选给出一对线索',{'hintText':'四个角不是同一种图案；右下角能与第二行图案配对'})]
for i,(title,rows,preview,maxerr,goal,skill,disc,ex) in enumerate(memory_levels,1):
 cells=[r.split() for r in rows]
 pos={}
 for r,rr in enumerate(cells):
  for c,letter in enumerate(rr):pos.setdefault(letter,[]).append([r,c])
 content={'grid':{'rows':len(cells),'cols':len(cells[0])},'faces':cells,'previewSeconds':preview,'maxMismatches':maxerr,'turnRules':{'flipTwo':'matching pair stay faceup; mismatch waits 0.7s and flips back','pauseDuringMismatchedFlip':True,'matchedCardsCannotFlipAgain':True},'goal':{'type':'match-all','pairs':len(pos)},'clues':ex,'layoutTransforms':['identity','mirror-horizontal','mirror-vertical'] if i>=3 else ['identity'],'transformsApplyToEntireBoard':True,'progressPersist':'matched ids + mismatches + active two flips + preview timer'}
 plan=[{'symbol':sym,'positions':positions} for sym,positions in sorted(pos.items())]
 make('memory-flip',i,title,goal,'记忆策略或推理顺序决定翻牌效率',skill,disc,content,{'pairs':plan,'approach':'先利用提示再按主题区域扫描，所有匹配都可用该矩阵复核'},['每个符号恰好两张，参考配对表覆盖全部格子；线索经过事实校验','错误次数超过限制失败但允许立即重试；变换必须同步更新正确线索','触摸单张卡的命中区域≥44px，不会翻同一张两次'],(35,140),notes='布局对称变换仅用于重玩变化，关卡原理不变；不能对称变换卡片却不更新线索',feature=['fixed_memory_board','cognitive_clue_mode'])

# 2048 无随机砖，官方经典模式不动；6份固定棋盘由最短 BFS 真正求解
merge_boards=[
('第一次合并',[[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],4,2,'把两枚2合成4','方向一次选择，合并后的格子位置会改变','可用向左也可用向右，方案多于一种'),
('双排规划',[[2,2,4,4],[0,0,0,0],[0,0,0,0],[0,0,0,0]],8,2,'形成一枚8','同一滑动可能发生两次不同合并','观察合并是“每一格每回合最多合并一次”'),
('先八后十六',[[4,4,8,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],16,3,'三步内得到16','先把两枚4合成8，再用两个8合16','第二次同向移动仍然可能有效'),
('纵向接力',[[2,2,0,0],[2,2,0,0],[0,0,0,0],[0,0,0,0]],8,3,'最多三步得到8','先横向再纵向组合两排','合并顺序会影响最终位置'),
('双列八进位',[[2,4,2,0],[2,4,2,0],[4,8,4,0],[0,0,0,0]],16,4,'四步内获得16','先合并列再观察8如何重合','棋盘上下移动可改变相邻关系'),
('终极转位',[[4,0,0,0],[16,2,8,2],[4,0,4,0],[0,2,8,0]],32,5,'六步内获得32','允许暂时远离目标，先安排大数对位','分辨合并不能直接跨越不同数值')]
def merge_line(v):
 a=[x for x in v if x];o=[];i=0
 while i<len(a):
  if i+1<len(a) and a[i]==a[i+1]:o.append(2*a[i]);i+=2
  else:o.append(a[i]);i+=1
 return o+[0]*(4-len(o))
def merge_step(board,dir):
 b=[list(x) for x in board]
 if dir in ('L','R'):
  for i in range(4):
   row=b[i] if dir=='L' else b[i][::-1]
   res=merge_line(row)
   b[i]=res if dir=='L' else res[::-1]
 else:
  for j in range(4):
   col=[b[i][j] for i in range(4)]
   col=col if dir=='U' else col[::-1]
   res=merge_line(col)
   res=res if dir=='U' else res[::-1]
   for i in range(4):b[i][j]=res[i]
 return tuple(tuple(x) for x in b)
def merge_solve(board,target,maxmoves):
 start=tuple(tuple(r) for r in board);q=collections.deque([(start,'')]);seen={start}
 while q:
  b,steps=q.popleft()
  if max(max(r) for r in b)>=target:return steps,b
  if len(steps)>=maxmoves:continue
  for d in 'LURD':
   nxt=merge_step(b,d)
   if nxt==b or nxt in seen:continue
   seen.add(nxt);q.append((nxt,steps+d))
 return None,None
for i,(title,board,target,moves,goal,skill,disc) in enumerate(merge_boards,1):
 route,after=merge_solve(board,target,moves)
 content={'grid':{'rows':4,'cols':4},'initialBoard':board,'challengeSpawnPolicy':'none (no new random or scripted tile after move)','maxValidMoves':moves,'undoAllowed':True,'undoDoesNotRefundMoveOnRankedAttempt':True,'win':{'anyTileAtLeast':target},'lose':'valid moves used up without target or no legal move','scorePolicy':'挑战按有效步数、辅助使用分层统计；经典分数保持不变','controls':'四方向滑动；仅有效改变盘面的滑动计步'}
 make('merge-2048',i,title,goal,'每一步选择朝向并预判合并次序',skill,disc,content,{'directions':list(route) if route is not None else None,'resultBoard':[list(x) for x in after] if after else None},['宽搜可在限定步数找到方案；无解题卡不可入库','超出有效步数/无可移动后失败，撤销的成绩标签与普通成绩不同','四向滑动阈值一致，不因页面滚动误触，画布外不禁用普通触摸'],(15,95),feature=['fixed_2048_board','challenge_no_spawn','target_tile'])

for g in ('snake-run','mole-whack','memory-flip','merge-2048'):
 (LEV/(g+'.json')).write_text(json.dumps({'gameId':g,'gameName':meta[g][0],'sourceFile':meta[g][1],'stages':all_games[g]},ensure_ascii=False,indent=2)+'\n')
print('ALL',len(all_games),sum(map(len,all_games.values())))
print('2048 witnesses',[(x['id'],x['referencePlan']['directions']) for x in all_games['merge-2048']])
print('SNAKE',[(x['id'],x['referencePlan']['totalSteps']) for x in all_games['snake-run']])
print('ROAD',[(x['id'],x['referencePlan']['safeLaneBySlot']) for x in all_games['road-rush']])
