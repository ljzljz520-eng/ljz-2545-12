import { test, eq, ok } from './run.js';
import { OfflineCache, memoryStorage } from '../src/cache.js';

test('离线快照在 TTL 内为 fresh 并回显数据与时点', () => {
  const cache = new OfflineCache({ storage: memoryStorage() });
  cache.save('advisories', { v: 1 }, { ttlMs: 1000, savedAt: 10_000 });
  const r = cache.load('advisories', 10_500);
  eq(r.status, 'fresh');
  eq(r.data.v, 1);
  eq(r.savedAt, 10_000);
});

test('缓存过期：status=expired，数据可见但必须标注，禁止伪装成最新', () => {
  const cache = new OfflineCache({ storage: memoryStorage() });
  cache.save('advisories', { v: 1 }, { ttlMs: 1000, savedAt: 10_000 });
  const r = cache.load('advisories', 12_001);
  eq(r.status, 'expired');
  eq(r.data.v, 1, '过期数据仍可读（供离线参考）');
});

test('无缓存=missing；清除后回 missing', () => {
  const cache = new OfflineCache({ storage: memoryStorage() });
  eq(cache.load('x').status, 'missing');
  cache.save('x', 1, { ttlMs: 10, savedAt: 0 });
  cache.clear('x');
  eq(cache.load('x').status, 'missing');
});
