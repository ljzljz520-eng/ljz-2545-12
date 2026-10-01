import { test, eq, ok, approx } from './run.js';
import {
  AppStore, lifecycleState, confirmCandidate, manualConfirmSegment, addRevisit,
  buildAdvisories, rejectAllCandidates,
} from '../src/advisory.js';
import { buildViewModel } from '../src/view.js';
import { matchAcrossNetwork } from '../src/association.js';
import { buildSeedRoutes, buildSeedObservations, NOW, createObservation } from '../src/model.js';

function store() { return AppStore.seed(NOW); }

test('生命周期：施工过期=待更新而非安全；普通过期=expired；未生效=upcoming', () => {
  const s = store();
  const o7 = s.observations.find((o) => o.id === 'O7');
  eq(lifecycleState(o7, NOW), 'stale-construction');
  const plain = createObservation('P', {
    type: 'ramp', point: [10, 120], radius: 5,
    observedAt: '2026-06-01T00:00:00+08:00', startAt: '2026-06-01T00:00:00+08:00', endAt: '2026-07-01T00:00:00+08:00',
  });
  eq(lifecycleState(plain, NOW), 'expired');
  const soon = createObservation('P2', {
    type: 'ramp', point: [10, 120], radius: 5,
    observedAt: NOW, startAt: '2026-12-01T00:00:00+08:00', endAt: null,
  });
  eq(lifecycleState(soon, NOW), 'upcoming');
});

test('施工过期仍显著提示（needs-update/warn），不能当作已恢复', () => {
  const s = store();
  const ads = s.advisories();
  const o7 = ads.find((a) => a.observationId === 'O7');
  ok(o7, 'O7 必须仍在提示列表');
  eq(o7.kind, 'needs-update');
  eq(o7.tone, 'warn');
  eq(o7.segment.segmentKey, 'BJH|0|S1', '提示绑定具体段 S1');
});

test('回访否定(absent)立即压制提示但保留旧记录；cleared 仅在确认恢复后归档', () => {
  const s = store();
  const o8 = s.observations.find((o) => o.id === 'O8');
  const o9 = s.observations.find((o) => o.id === 'O9');
  eq(lifecycleState(o8, NOW), 'negated');
  eq(lifecycleState(o9, NOW), 'cleared');
  const ids = s.advisories().map((a) => a.observationId);
  ok(!ids.includes('O8'), '被否定旧记录不提示');
  ok(!ids.includes('O9'), '已确认恢复记录不提示');
  ok(o8.revisits.length === 1 && o9.revisits.length === 1, '旧记录与回访仍保留在后台');
});

test('有效期交叠：确认后两条记录各自成提示，不互相吞掉；未确认者先不提示', () => {
  const s = store();
  // O6 初始 pending → 无提示
  ok(!s.advisories().some((a) => a.observationId === 'O6'), 'pending 候选不得用于提示');
  const o6 = s.observations.find((o) => o.id === 'O6');
  const candS2 = o6.candidates.find((c) => c.segmentId === 'S2');
  confirmCandidate(o6, candS2, { at: NOW, by: '编辑甲' });
  const s2ads = s.advisories().filter((a) => a.segment?.segmentKey === 'BJH|0|S2');
  eq(s2ads.length, 2, 'O4 与 O6 交叠但各自一条提示');
  // 里程区间交叠可判
  const [a, b] = s2ads.map((x) => [x.segment.fromMeter, x.segment.toMeter]);
  ok(a[1] >= b[0] && b[1] >= a[0], '两条影响区间确实交叠');
});

test('人工纠错：O2 的自动首选是错误层桥面，手工改到桥下 U1 后才提示', () => {
  // 直接构造未确认状态验证“自动首选会错”
  const routes = new Map(Object.entries(buildSeedRoutes()));
  const obs = buildSeedObservations().find((o) => o.id === 'O2');
  // seed store 已做过纠错；这里对“干净记录”重放自动匹配
  const autoSorted = matchAcrossNetwork(obs, [...routes.values()]);
  ok(autoSorted[0].segmentId === 'D1' && autoSorted[0].sameLevel === false,
    '自动几何首选为错误层桥面 D1（这正是必须人工确认的原因）');
  // 手工纠错到 U1
  const s = store();
  const o2 = s.observations.find((x) => x.id === 'O2');
  eq(o2.association.segmentId, 'U1');
  eq(o2.association.method, 'manual');
  ok(o2.association.provenance.note.includes('纠错'), '保留纠错审计说明');
  const adv = s.advisories().find((a) => a.observationId === 'O2');
  eq(adv.segment.segmentKey, 'UND|0|U1');
  ok(adv.segment.level === 0, '提示位于地面层而非桥面');
});

test('拒绝全部候选后不提示；后续补回访 present 不会绕过确认', () => {
  const s = store();
  const o3 = s.observations.find((o) => o.id === 'O3');
  // O3 已手工确认 F3；重置为拒绝态
  rejectAllCandidates(o3, { at: NOW });
  ok(!s.advisories().some((a) => a.observationId === 'O3'));
  addRevisit(o3, { at: NOW, conclusion: 'present', note: '仍存在' });
  ok(!s.advisories().some((a) => a.observationId === 'O3'), '回访 present 也不能替代路段确认');
});

test('提示不扩散到整条路线：视图中未受影响段 affected=false', () => {
  const s = store();
  const vm = buildViewModel(s.advisories(), s.routes);
  const binhe = vm.mapLayers.find((l) => l.routeId === 'R-binhe' && l.version === s.activeVersions['R-binhe']);
  const affectedKeys = binhe.segments.filter((x) => x.affected).map((x) => x.segmentKey);
  ok(affectedKeys.length < binhe.segments.length, '只点亮受影响段');
  ok(affectedKeys.includes('BJH|0|S2') && affectedKeys.includes('BJH|0|S1'), '受影响段被点亮');
});

test('屏幕阅读器锚点：同一受影响段在列表与地图共享 anchor', () => {
  const s = store();
  const vm = buildViewModel(s.advisories(), s.routes);
  const item = vm.listItems.find((i) => i.observationId === 'O2');
  const layer = vm.mapLayers.find((l) => l.routeId === 'R-under');
  const seg = layer.segments.find((x) => x.segmentKey === 'UND|0|U1');
  ok(seg.anchors.includes(item.anchor), '列表项锚点必须出现在对应地图段上');
  ok(item.location && typeof item.location.fromMeter === 'number' && item.location.toMeter > item.location.fromMeter, '列表给出可计算的里程区间');
  // 每条提示都带来源与时点
  ok(item.source && item.observedAt, '展示来源与观察时点');
});

test('改线后提示标注 migratedFromVersion；身份消失的不出地图点', () => {
  const s = store();
  s.setActiveVersion('R-binhe', 2);
  const ads = s.advisories();
  const o4 = ads.find((a) => a.observationId === 'O4');
  eq(o4.segment.migratedFromVersion, 1, 'O4 自 v1 迁移，里程已按 v2 重算');
  const vm = buildViewModel(ads, s.routes);
  const binheV2 = vm.mapLayers.find((l) => l.routeId === 'R-binhe' && l.version === 2);
  const segKeys = binheV2.segments.map((x) => x.segmentKey);
  ok(!segKeys.includes('BJH|0|S3'), 'v2 无 S3');
  const o5item = vm.listItems.find((i) => i.observationId === 'O5');
  eq(o5item.location, null, 'stale 记录无可定位段');
  ok(o5item.lastGood && o5item.lastGood.version === 1, '保留最后有效版本依据');
});

test('双向过滤：reverse 视图里程反向但锚点段不变', () => {
  const s = store();
  s.setActiveVersion('R-binhe', 1);
  const fwd = buildViewModel(s.advisories(), s.routes, { travelDirection: 'forward' });
  const rev = buildViewModel(s.advisories(), s.routes, { travelDirection: 'reverse' });
  const f = fwd.listItems.find((i) => i.observationId === 'O4');
  const r = rev.listItems.find((i) => i.observationId === 'O4');
  eq(f.location.segmentKey, r.location.segmentKey);
  approx(f.location.centerMileage + r.location.centerMileage, 400, 0.5, 'v1 全长 400m');
});


test('同一段含交叠多提示时：地图段 anchors 聚合同段全部记录，列表各自独立', () => {
  const s = store();
  s.setActiveVersion('R-binhe', 2);
  const o6 = s.observations.find((o) => o.id === 'O6');
  confirmCandidate(o6, o6.candidates.find((c) => c.segmentId === 'S2' && c.version === 2), { at: NOW });
  const ads = s.advisories();
  const vm = buildViewModel(ads, s.routes);
  const layer = vm.mapLayers.find((l) => l.routeId === 'R-binhe' && l.version === 2);
  const seg2 = layer.segments.find((x) => x.segmentKey === 'BJH|0|S2');
  ok(seg2.anchors.length === 2, 'S2 段聚合 O4 与 O6 两个锚点');
  const anchors = vm.listItems.filter((i) => i.location?.segmentKey === 'BJH|0|S2').map((i) => i.anchor);
  eq(anchors.sort(), seg2.anchors.sort(), '列表锚点与地图段锚点一致');
  const o6item = vm.listItems.find((i) => i.observationId === 'O6');
  eq(o6item.construction, true);
  ok(o6item.endAt < NOW === false, 'O6 在演示时点仍有效');
});

test('所有列表项均带来源与观察时点；stale 项保留最后有效版本且 location 为 null', () => {
  const s = store();
  s.setActiveVersion('R-binhe', 2);
  const vm = buildViewModel(s.advisories(), s.routes);
  vm.listItems.forEach((it) => ok(it.source && it.observedAt, `${it.observationId} 必须展示来源与时点`));
  const o5 = vm.listItems.find((i) => i.observationId === 'O5');
  eq(o5.location, null);
  eq(o5.lastGood.version, 1);
});
