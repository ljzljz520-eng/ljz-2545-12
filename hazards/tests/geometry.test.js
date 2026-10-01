import { test, eq, ok, approx } from './run.js';
import { projectOnSegment, nearestOnPolyline, locateAlong, polylineLength } from '../src/geometry.js';

test('投影落在线段内部', () => {
  const r = projectOnSegment([10, 5], [0, 0], [20, 0]);
  approx(r.distance, 5); eq(r.inside, true); approx(r.point[0], 10);
});

test('投影夹到端点时标记 outside，不静默外推', () => {
  const r = projectOnSegment([-10, 0], [0, 0], [20, 0]);
  eq(r.inside, false); approx(r.point[0], 0);
});

test('折返折线：点在两个平行段等距时保留多个候选（歧义不收敛为单解）', () => {
  const coords = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const cands = nearestOnPolyline([30, 30], coords);
  eq(cands.length, 3);
  approx(cands[0].distance, cands[1].distance, 0.001, '两个近邻段应等距');
  ok(cands[0].segmentIndex !== cands[1].segmentIndex, '候选必须来自不同段');
});

test('locateAlong 里程定位与夹取标记', () => {
  const coords = [[0, 0], [100, 0], [100, 100]];
  eq(polylineLength(coords), 200);
  approx(locateAlong(coords, 150).point[1], 50);
  eq(locateAlong(coords, 999).clamped, true);
});
