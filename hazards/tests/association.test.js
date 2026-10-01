import { test, eq, ok, approx } from './run.js';
import { projectToVersion, matchAcrossNetwork, findSegmentInVersion } from '../src/association.js';
import { createObservation, buildSeedRoutes } from '../src/model.js';

const routes = new Map(Object.entries(buildSeedRoutes()));

test('上下层重叠道路：桥面点保留 D1/U1 两个候选，身份候选 D1 排前', () => {
  const obs = createObservation('X1', {
    type: 'narrow_bridge', point: [150, 300], level: 1,
    roadCode: 'BRD', segmentId: 'D1', radius: 20,
    observedAt: '2026-001'.replace('2026-001', '2026-09-20T10:00:00+08:00'),
    startAt: '2026-09-21T00:00:00+08:00', endAt: null,
  });
  const all = matchAcrossNetwork(obs, [...routes.values()]);
  const d1 = all.find((c) => c.segmentId === 'D1');
  const u1 = all.find((c) => c.segmentId === 'U1');
  ok(d1 && u1, '桥面与桥下候选都应保留');
  ok(all.indexOf(d1) < all.indexOf(u1), '身份+同层候选 D1 应优先于误配的桥下 U1');
  eq(d1.segmentIdMatch, true);
  eq(u1.sameLevel, false, 'U1 层级不同必须明示');
  ok(u1.distance < obs.radius, '桥下点虽在缓冲内但层级不符，只作候选不采信');
});

test('圆形缓冲匹配 vs 路段身份关联：分层字段可判别', () => {
  const obs = createObservation('X2', {
    type: 'ramp', point: [150, 300], level: 0, radius: 12,
    observedAt: '2026-09-25T18:30:00+08:00',
    startAt: '2026-09-26T00:00:00+08:00', endAt: null,
  });
  const bridge = routes.get('R-bridge@1');
  const under = routes.get('R-under@1');
  const cb = projectToVersion(obs, under)[0];
  const onBridge = projectToVersion(obs, bridge);
  eq(cb.tier, 'buffer');
  ok(onBridge.length > 0, '错误层桥面在半径内也被保留为候选');
  eq(onBridge[0].sameLevel, false);
  eq(onBridge[0].tier, 'buffer');
});

test('折返另一段：歧义点的候选含 F1 与 F3，自动排序后仍需人工确认', () => {
  const obs = createObservation('X3', {
    type: 'lighting', point: [60, 450], level: 0, radius: 65,
    observedAt: '2026-09-28T20:00:00+08:00',
    startAt: '2026-09-28T00:00:00+08:00', endAt: null,
  });
  const fold = routes.get('R-fold@1');
  const cands = projectToVersion(obs, fold);
  const f1 = cands.find((c) => c.segmentId === 'F1');
  const f3 = cands.find((c) => c.segmentId === 'F3');
  ok(f1 && f3, '来向段 F1 与折返段 F3 都应作为候选保留');
  approx(f1.distance, f3.distance, 0.001, '两段平面等距时必须并列保留距离依据');
  // 观察记录无身份提示 → 没有 identity 候选 → 自动结果全部 pending
  ok(cands.every((c) => c.tier === 'buffer'), '无身份记录只能给缓冲候选');
});

test('候选带里程、投影点与缓冲判定依据', () => {
  const obs = createObservation('X4', {
    type: 'lighting', point: [150, 120], level: 0,
    roadCode: 'BJH', segmentId: 'S2', radius: 15,
    observedAt: '2026-09-15T09:00:00+08:00',
    startAt: '2026-09-15T00:00:00+08:00', endAt: null,
  });
  const v1 = routes.get('R-binhe@1');
  const [best] = projectToVersion(obs, v1);
  eq(best.segmentId, 'S2');
  eq(best.tier, 'identity');
  approx(best.mileage, 150, 0.1, 'S2 中点里程应为 150m');
  approx(best.projectedPoint[0], 150);
});

test('稳定身份可跨版本找到，消失身份返回 null（不臆造映射）', () => {
  const v2 = routes.get('R-binhe@2');
  ok(findSegmentInVersion(v2, 'BJH', 0, 'S2'), 'S2 身份在 v2 保留');
  eq(findSegmentInVersion(v2, 'BJH', 0, 'S3'), null, 'S3 在 v2 已取消');
});
