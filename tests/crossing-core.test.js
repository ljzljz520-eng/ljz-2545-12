const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/crossing-core.js');

global.window = global;
global.window.CrossingCore = core;
require('../js/crossing-data.js');
const { routes, observations } = global.window.CrossingData;

const byId = (list, id) => list.find((item) => item.id === id);
const now = core.APP_NOW;

test('上下层重叠道路：桥面与桥下道路同时保留候选和距离依据', () => {
  const record = byId(observations, 'OBS-BR-03');
  const match = core.matchObservation(record, routes.v2026);
  const ids = match.candidates.map((c) => c.segmentId);

  assert.ok(ids.includes('OB3'), '应保留真实窄桥桥面 OB3');
  assert.ok(ids.includes('IN2'), '应保留桥下道路 IN2 作为易错候选');
  assert.equal(match.layer, 'identity_with_competing_geometry');
  assert.equal(match.associationStatus, 'manual_review');
  assert.equal(match.nearestGeometry.segmentId, 'IN2');
  assert.equal(match.nearestIdentity.segmentId, 'OB3');
  assert.ok(match.nearestIdentity.distanceM < 50);
});

test('双向路线：去程和回程分别计算方向与里程', () => {
  const ramp = byId(observations, 'OBS-SLP-01');
  const lighting = byId(observations, 'OBS-CON-04');
  const rampMatch = core.matchObservation(ramp, routes.v2026);
  const lightMatch = core.matchObservation(lighting, routes.v2026);

  assert.equal(rampMatch.nearestIdentity.segmentId, 'OB1');
  assert.equal(rampMatch.nearestIdentity.direction, 'outbound');
  assert.equal(lightMatch.nearestIdentity.segmentId, 'IN2');
  assert.equal(lightMatch.nearestIdentity.direction, 'inbound');
  assert.ok(Math.abs(lightMatch.nearestIdentity.routeM - 229.7) < 0.2);
});

test('折返另一段：折返身份进入身份层，但仍需人工确认后才发布', () => {
  const record = byId(observations, 'OBS-LT-05');
  const match = core.matchObservation(record, routes.v2026);
  assert.equal(match.nearestIdentity.segmentId, 'TB1');
  assert.equal(match.layer, 'identity_and_geometry');
  assert.equal(match.associationStatus, 'ready_for_editor_confirmation');
  assert.equal(core.isPublished(record, now, routes.v2026.id), false);
});

test('圆形缓冲只给几何候选，不能替代道路段身份', () => {
  const old = byId(observations, 'OBS-LIGHT-OLD-DENIED');
  const match = core.matchObservation(old, routes.v2026);
  assert.equal(match.layer, 'geometry_only');
  assert.ok(match.circularBufferMatches.length >= 1);
  assert.equal(match.roadIdentityMatches.length, 0);
  assert.equal(core.isPublished(old, now, routes.v2026.id), false);
});

test('有效期交叠只在同一确认路段上报告，不把提示扩散到全部路线', () => {
  const warnings = core.findIntervalOverlaps(observations);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].recordIds.sort(), ['OBS-SLP-01', 'OBS-SURF-02']);
  assert.equal(warnings[0].segmentId, 'OB1');

  const activeIds = core.activeAlerts(observations, now, routes.v2026.id).map((r) => r.id).sort();
  assert.deepEqual(activeIds, ['OBS-CON-04', 'OBS-SLP-01']);
});

test('回访否定旧记录后即使有效期仍覆盖当前日期也不发布', () => {
  const denied = byId(observations, 'OBS-LIGHT-OLD-DENIED');
  assert.equal(core.intervalStatus(denied, now), 'denied');
  assert.equal(core.isPublished(denied, now, routes.v2026.id), false);
  assert.equal(core.activeAlerts(observations, now, routes.v2026.id).some((r) => r.id === denied.id), false);
});

test('施工过期表示信息待更新，不推导为现场安全', () => {
  const expired = byId(observations, 'OBS-CON-EXPIRED');
  assert.equal(core.intervalStatus(expired, now), 'expired');
  assert.equal(core.isPublished(expired, now, routes.v2026.id), false);
});

test('改线重算保持观察坐标不变，并保留旧/新里程依据', () => {
  const ramp = byId(observations, 'OBS-SLP-01');
  const snapshot = core.recalculateMeasure(ramp, routes.v2025, routes.v2026);
  assert.deepEqual(snapshot.observationPoint, ramp.observationPoint);
  assert.equal(snapshot.driftedCoordinate, false);
  assert.ok(snapshot.oldM > 0 && snapshot.newM > 0);
  assert.notEqual(snapshot.oldM, snapshot.newM);

  const bridge = byId(observations, 'OBS-BR-03');
  const missing = core.recalculateMeasure(bridge, routes.v2026, routes.v2025);
  assert.equal(missing.targetSegmentId, null);
  assert.deepEqual(missing.observationPoint, bridge.observationPoint);
});

test('确认后影响范围被裁剪在具体路段起止里程内', () => {
  const record = byId(observations, 'OBS-CON-04');
  const match = core.matchObservation(record, routes.v2026);
  const extent = core.makeImpactExtent(match, 'IN2', record.impactRadiusM);
  assert.equal(extent.segmentId, 'IN2');
  assert.ok(extent.startM >= 0);
  assert.ok(extent.endM <= extent.centerM + record.impactRadiusM + 0.1);
  assert.match(extent.basis, /道路身份=命中/);
});

test('离线新鲜缓存可用，过期缓存必须阻断', () => {
  const fresh = core.evaluateCache({ cachedAt: '2026-10-01T07:30:00+08:00' }, now, { offline: true });
  assert.equal(fresh.state, 'offline_fresh_cache');
  assert.equal(fresh.useCache, true);

  const expired = core.evaluateCache({ cachedAt: '2026-09-29T07:30:00+08:00' }, now, { offline: true });
  assert.equal(expired.state, 'offline_expired_cache');
  assert.equal(expired.useCache, false);
});
