import { test, eq, ok, approx } from './run.js';
import { describeOnVersion, recomputeForVersion, mileageForDirection } from '../src/route.js';
import { buildSeedRoutes, buildSeedObservations, NOW } from '../src/model.js';
import { confirmCandidate, AppStore } from '../src/advisory.js';

const routes = new Map(Object.entries(buildSeedRoutes()));

test('改线后身份保留：里程沿 v2 重新计算，投影点随版本移动但非静默漂移', () => {
  const store = AppStore.seed(NOW);
  const o4 = store.observations.find((o) => o.id === 'O4');
  const v1 = routes.get('R-binhe@1');
  const v2 = routes.get('R-binhe@2');
  const d1 = describeOnVersion(o4.association, v1);
  const d2 = describeOnVersion(o4.association, v2);
  approx(d1.centerMileage, 150, 0.1, 'v1 里程 150m');
  approx(d2.centerMileage, 153.9, 0.2, 'v2 绕行后 S2 中心里程 ≈153.9m');
  ok(d1.point[1] !== d2.point[1], '坐标确实变化（绕行），但由新版本派生，可追溯');
  const re = recomputeForVersion(o4.association, d1, v2);
  eq(re.status, 'current');
});

test('改线后身份消失：version-stale，保留旧版本/旧里程/旧点，不产生新坐标', () => {
  const store = AppStore.seed(NOW);
  const o5 = store.observations.find((o) => o.id === 'O5');
  const v1 = routes.get('R-binhe@1');
  const v2 = routes.get('R-binhe@2');
  const oldDesc = describeOnVersion(o5.association, v1);
  const re = recomputeForVersion(o5.association, oldDesc, v2);
  eq(re.status, 'version-stale');
  eq(re.lastGoodVersion, 1);
  approx(re.lastGoodMileage, 250, 0.1);
  eq(re.lastGoodPoint, oldDesc.point, '旧点原样保留，绝不挪到别的段');
});

test('双向路线：reverse 方向里程对称换算，不改动底层受影响段', () => {
  const v1 = routes.get('R-binhe@1');
  const store = AppStore.seed(NOW);
  const o4 = store.observations.find((o) => o.id === 'O4');
  const d = describeOnVersion(o4.association, v1);
  const fwd = mileageForDirection(d, v1, 'forward');
  const rev = mileageForDirection(d, v1, 'reverse');
  approx(rev.centerMileage, v1.length - fwd.centerMileage, 0.1);
  approx(rev.fromMeter + fwd.toMeter, v1.length, 0.1);
  eq(d.segmentKey, 'BJH|0|S2', '无论哪个方向，受影响的仍是同一路段');
});

test('version-stale 记录的提示不携带新 segment（旧坐标不能用于提示）', () => {
  const store = AppStore.seed(NOW);
  store.setActiveVersion('R-binhe', 2);
  const ads = store.advisories();
  const stale = ads.find((a) => a.observationId === 'O5');
  eq(stale.kind, 'version-stale');
  eq(stale.segment, null);
  ok(/S3/.test(stale.text), '需说明身份消失原因');
});
