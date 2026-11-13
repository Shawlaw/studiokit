#!/usr/bin/env python3
import json,pathlib,collections
ROOT=pathlib.Path(__file__).resolve().parent.parent
META=[('shadow-leap','影跃','平台位点/世界高度'),('snowbells','雪铃','铃点/顺序'),('star-raid','星海突击','敌人事件/安全带'),('pendulum-tower','层塔','箱体顺序/偏置'),('block-drop','俄罗斯方块','20×10残局/操作答案'),('road-rush','极速车道','车流时隙/安全路线'),('gold-miner','黄金矿工','矿物坐标/抓取顺序'),('brick-breaker','砖块计划','8×5砖阵/机关'),('gravity-flip','重力翻转','障碍坐标/翻转窗口'),('snake-run','贪吃蛇','18×18障碍/水果/蛇身路线'),('mole-whack','打地鼠','洞口事件时间轴'),('memory-flip','记忆翻牌','卡牌面阵/配对答案'),('merge-2048','2048合成','4×4盘面/求解答案')]
ALL=[]; summary=['# Arcade 0.9.0 首批关卡索引（78 关）','', '> 这是 **0.9.0 候选设计资源**，不是已经开发、试玩、发布的 0.9.0。0.8.0 开发中的分支和任务禁止覆盖。','', '| 游戏 | 六关主题 | 详细蓝图 |','|---|---|---|']
for gid,name,kind in META:
 g=json.loads((ROOT/'levels'/f'{gid}.json').read_text('utf-8'))
 lines=[f'# {name}｜6 关可实施蓝图', '', f'- 游戏 ID：`{gid}`；当前公开主干对应文件：`apps/arcade/games/{g["sourceFile"]}`', f'- 数据源：`../levels/{gid}.json`，每关单文件在 `../levels/stages/{gid}-Cxx.json`',f'- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：{kind}', '- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。','', '## 章节总览','','| # | 关卡 | 目标 | 技巧 | 发现 |', '|---:|---|---|---|---|']
 for stage in g['stages']:
  ALL.append(stage)
  lines.append(f"| {stage['stageNumber']} | {stage['title']} | {stage['goalStatement']} | {stage['practicedSkill']} | {stage['discovery']} |")
 titles=' / '.join(s['title'] for s in g['stages'])
 summary.append(f'| {name} | {titles} | [蓝图]({gid}.md) |')
 lines.extend(['','## 逐关详细规格',''])
 for s in g['stages']:
  lines+= [f"### C{s['stageNumber']:02d} · {s['title']}",'',f"- **通关目标**：{s['goalStatement']}",f"- **关卡决策**：{s['decision']}",f"- **练习重点**：{s['practicedSkill']}",f"- **探索反馈**：{s['discovery']}",f"- **建议有效时长**：{s['targetDurationSec'][0]}–{s['targetDurationSec'][1]} 秒",'- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：','', '```json', json.dumps(s['content'],ensure_ascii=False,indent=2),'```','','- **参考通关方案**：','','```json',json.dumps(s['referencePlan'],ensure_ascii=False,indent=2),'```','', '**验收工单**：','',f"1. **成功路径**：{s['acceptance']['success']}",f"2. **失败路径**：{s['acceptance']['failure']}",f"3. **移动端**：{s['acceptance']['mobile']}",f"4. **AFK**：{s['acceptance']['afk']}",'',f"**策划备注**：{s['designerNotes'] or '无额外备注'}",'', '---','']
  stagefile=ROOT/'levels'/'stages'/f"{s['id']}.json";stagefile.parent.mkdir(exist_ok=True,parents=True);stagefile.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 (ROOT/'docs'/f'{gid}.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
summary+=['','## 验证范围','', '- 俄罗斯方块/2048：参考操作由独立规则模拟器回放验证。','- 贪吃蛇：参考转向由蛇身 BFS 生成并逐格复放，包含尾部占用及长度增长。','- 极速车道：基于离散时隙的车道邻接路径验证，真实变道过渡碰撞仍需引擎检查。','- 黄金矿工：参考抓取价值与直线目标前方障碍检查，钩爪时间/物理须进一步验证。','- 影跃/雪铃/重力翻转/层塔/弹幕/打砖：静态结构合理性检查，不等同物理可玩性证明。','', '运行：`python3 scripts/validate_levels.py`。']
(ROOT/'docs'/'LEVEL-INDEX.md').write_text('\n'.join(summary)+'\n',encoding='utf-8')
manifest={'packVersion':'0.9.0-design-v1','observedPublicMainArcadeVersion':'0.7.0','observedAt':'2026-11-13','notForImmediateMergeInto0.8':True,'stageCount':len(ALL),'gameCount':len(META),'contentSchema':'1.0.0','gameFiles':[{'gameId':k,'name':n,'filename':f'levels/{k}.json','count':6} for k,n,_ in META],'verificationClasses':{'reference_replayed':['block-drop','merge-2048','snake-run','road-rush','memory-flip'],'structural_only':['shadow-leap','snowbells','star-raid','pendulum-tower','gold-miner','brick-breaker','gravity-flip','mole-whack']}}
(ROOT/'PACK-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Task staging: no automatic repo import. An agent takes a single designated game stage only after OWNER gating.
base=[{'id':'LD90-P00','type':'owner-gate','title':'0.8.0收束与0.9.0启动授权','status':'BLOCKED_OWNER','dependsOn':[],'scope':'仅阅读当前HEAD/0.8.0实施差异；未经Owner批准不能改业务代码','acceptance':'0.8.0状态、未完成PR、已实现玩法和待迁移schema核对完毕，Owner明确同意0.9分支'},
 {'id':'LD90-P01','type':'foundation','title':'0.8与蓝图对照/接口契约','status':'PLANNED','dependsOn':['LD90-P00'],'scope':'只补挑战关适配器（不重写经典模式）','acceptance':'mode/challenge stageId+stageSchema+暂停/存档版本+可测事件公开，完成基础测试'},
 {'id':'LD90-P02','type':'foundation','title':'关卡验证器与复放测试接入','status':'PLANNED','dependsOn':['LD90-P01'],'scope':'对levels JSON构建导入和校验；跑本包validator','acceptance':'至少旧游戏烟雾测试不回归，关卡切换不污染高分存档'},
 {'id':'LD90-P03','type':'foundation','title':'移动端控制与暂停/续玩基线','status':'PLANNED','dependsOn':['LD90-P01'],'scope':'各游戏新增功能必须在同样输入语义下兼容多指/失焦','acceptance':'320/375/390/430 CSS px 横竖、切后台/锁屏/刷新、点按连续可验证'}]
tasks=base[:]
for k,name,kind in META:
 prev=None
 for i in range(1,7):
  s=next(z for z in ALL if z['gameId']==k and z['stageNumber']==i)
  tid=f'LD90-{k.replace("-","").upper()}-{i:02d}'
  deps=['LD90-P02','LD90-P03'] if i==1 else [prev]
  tasks.append({'id':tid,'type':'implement-stage','gameId':k,'stageId':s['id'],'title':f'{name} C{i:02d} {s["title"]}','dependsOn':deps,'status':'PLANNED','targetBranch':'feat/arcade-0.9-gameplay','designSource':f'levels/stages/{s["id"]}.json','gameSource':f'apps/arcade/games/{next(g["sourceFile"] for g in [json.loads((ROOT/"levels"/f"{k}.json").read_text("utf-8"))])}','scope':'优先1关/PR；不可修改其他游戏规则或经典模式成绩；仅调整关卡适配器/本游戏/必要测试','acceptance':[s['acceptance']['success'],s['acceptance']['failure'],s['acceptance']['mobile'],s['acceptance']['afk'],'给出关卡回放/可复现证据与设计偏差说明；无Owner认可不得改关卡策划约束'],'ownerGate':i==3 if k=='shadow-leap' else i==6})
  prev=tid
ids=[t['id'] for t in tasks if t['type']=='implement-stage']
tasks += [{'id':'LD90-Q01','type':'review','title':'78关集成质量门禁','dependsOn':ids,'status':'PLANNED','scope':'独立reviewer检查经典隔离/存档/移动输入/可解性/关卡差异','acceptance':'78关数据与实现映射完整，违规关卡不得计为完成'}, {'id':'LD90-Q02','type':'release-gate','title':'Owner决定是否发布0.9.0','dependsOn':['LD90-Q01'],'status':'BLOCKED_OWNER','scope':'不得自动push/tag/main/deploy','acceptance':'Owner检查真机试玩记录及回滚清单后明确授权'}]
(ROOT/'tasks'/'PROPOSED-QUEUE-NOT-IMPORTED.json').write_text(json.dumps({'schemaVersion':'1.0','warning':'仅供参考，不自动导入0.8.0任务队列','tasks':tasks},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('rendered',len(ALL),'stages',len(tasks),'proposed tasks')
