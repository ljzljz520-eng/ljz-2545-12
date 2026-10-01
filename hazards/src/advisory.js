// 提示领域服务：纯函数为主，便于测试；AppStore 仅负责状态承载。
//
// 语义约定（务必保持）：
// - 自动关联的候选一律 pending；只有编辑确认（confirmed）才参与提示。
// - 有效期 overlap 时各记录各自成提示，不做合并吞噬。
// - 施工过期 = 信息待更新（needs-update），绝不等同现场已恢复安全，继续显著提示。
// - 非施工过期 = 不再主动告警，但记录保留；只有回访 cleared 才代表现场恢复安全。
// - 回访 absent（否定）立即压制提示，旧记录保留；cleared 归档。
// - 改线后身份保留则沿新版本重算里程；身份消失则 version-stale，不扩散、不漂移。

import { projectOnSegment, polylineLength } from './geometry.js';
import { matchAcrossNetwork } from './association.js';
import { describeOnVersion, recomputeForVersion } from './route.js';

// ---------- 时间工具 ----------
export function t(iso) { return new Date(iso).getTime(); }

export function latestRevisit(obs) {
  return obs.revisits.length ? obs.revisits[obs.revisits.length - 1] : null;
}

/**
 * 记录生命周期状态（与“是否提示”解耦）：
 * cleared 已确认恢复 / negated 被回访否定 / active 有效 /
 * stale-construction 施工过期待更新 / expired 普通过期 / upcoming 未生效
 */
export function lifecycleState(obs, nowIso) {
  const now = t(nowIso);
  const rev = latestRevisit(obs);
  if (rev?.conclusion === 'cleared') return 'cleared';
  if (rev?.conclusion === 'absent') return 'negated';
  if (t(obs.startAt) > now) return 'upcoming';
  if (obs.endAt && t(obs.endAt) < now) {
    return obs.construction ? 'stale-construction' : 'expired';
  }
  return 'active';
}

export const STATE_LABELS = {
  active: { text: '有效', tone: 'danger' },
  'stale-construction': { text: '施工已过期·信息待更新（不等于现场安全）', tone: 'warn' },
  expired: { text: '已过期（记录保留）', tone: 'muted' },
  upcoming: { text: '未生效', tone: 'info' },
  negated: { text: '回访否定·旧记录保留', tone: 'muted' },
  cleared: { text: '回访确认已恢复', tone: 'ok' },
};

// ---------- 自动关联 ----------
export function refreshCandidates(observations, routes) {
  const versions = [...routes.values()];
  observations.forEach((obs) => {
    obs.candidates = matchAcrossNetwork(obs, versions);
  });
  return observations;
}

// ---------- 人工确认 / 纠错 ----------
function candidateToAssociation(candidate, obs, by, at, impactMeters) {
  return {
    routeId: candidate.routeId,
    version: candidate.version,
    roadCode: candidate.roadCode,
    level: candidate.level,
    segmentId: candidate.segmentId,
    projectedPoint: candidate.projectedPoint,
    distance: candidate.distance,
    mileage: candidate.mileage,            // 确认版本上的投影里程（历史依据）
    autoTier: candidate.tier,              // identity | buffer | manual
    segmentIdMatch: candidate.segmentIdMatch,
    method: candidate.__manual ? 'manual' : 'auto',
    provenance: {
      chosenFromCandidates: true,
      candidateDistance: candidate.distance,
      candidateWithinRadius: candidate.withinRadius,
      candidateSameLevel: candidate.sameLevel,
      note: candidate.__manual ? '编辑手工指定真实路段（纠错）' : '编辑从自动候选中确认',
    },
    impactMeters: impactMeters ?? obs.impactMeters,
    confirmedBy: by,
    confirmedAt: at,
  };
}

/** 从自动候选列表中确认真实路段。 */
export function confirmCandidate(obs, candidate, { by = '编辑', at, impactMeters } = {}) {
  if (!candidate) throw new Error('确认关联必须指定候选');
  obs.association = candidateToAssociation(candidate, obs, by, at, impactMeters);
  return obs.association;
}

/**
 * 人工纠错：自动候选全部不对时，直接指定某版本中的路段身份。
 * 仍记录手工段与观察点的投影距离，审计可追溯。
 */
export function manualConfirmSegment(obs, routeVersion, seg, { by = '编辑', at, impactMeters } = {}) {
  const proj = nearestPointOnPolylineSeg(obs.point, seg.coords);
  let start = 0;
  for (const s of routeVersion.segments) {
    if (s === seg) break;
    start += polylineLength(s.coords);
  }
  const segLen = polylineLength(seg.coords);
  const candidate = {
    routeId: routeVersion.routeId,
    version: routeVersion.version,
    routeName: routeVersion.name,
    roadCode: seg.roadCode,
    level: seg.level,
    segmentId: seg.segmentId,
    projectedPoint: proj.point,
    distance: proj.distance,
    mileage: start + proj.sAlong,
    tier: 'manual',
    segmentIdMatch: false,
    sameLevel: obs.level === seg.level,
    withinRadius: proj.distance <= obs.radius,
    __manual: true,
  };
  obs.association = candidateToAssociation(candidate, obs, by, at, impactMeters);
  return obs.association;
}

export function rejectAllCandidates(obs, { by = '编辑', at } = {}) {
  obs.association = null;
  obs.candidatesReviewed = { rejected: true, by, at };
}

function segLength(coords) {
  return polylineLength(coords);
}

// 多点段上的最近投影：累计段内里程 sAlong。
function nearestPointOnPolylineSeg(point, coords) {
  let best = null;
  let offset = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const proj = projectOnSegment(point, a, b);
    if (!best || proj.distance < best.distance) {
      best = { ...proj, sAlong: offset + proj.t * segLen };
    }
    offset += segLen;
  }
  return best;
}

// ---------- 回访 ----------
export function addRevisit(obs, { at, conclusion, by = '回访员', note = '' }) {
  if (!['present', 'absent', 'cleared'].includes(conclusion)) {
    throw new Error('回访结论必须是 present / absent / cleared');
  }
  obs.revisits.push({ at, conclusion, by, note });
  return latestRevisit(obs);
}

// ---------- 提示生成 ----------
/**
 * 根据“当前启用的路线版本表”计算每条确认记录的受影响段。
 * 返回 advisory；提示只绑定具体 segment，绝不扩散到整条路线。
 */
export function buildAdvisories(observations, routes, activeVersions, nowIso) {
  const advisories = [];
  observations.forEach((obs) => {
    const state = lifecycleState(obs, nowIso);
    if (!obs.association) return; // 未确认候选不产生提示

    const { routeId } = obs.association;
    const activeVersion = activeVersions[routeId];
    const rv = activeVersion ? routes.get(`${routeId}@${activeVersion}`) : null;

    // 回访否定 / 已恢复：不出提示（旧记录仍在后台可见）。
    if (state === 'negated' || state === 'cleared') return;

    if (!rv) {
      advisories.push(makeAdvisory(obs, state, null, {
        kind: 'route-unavailable', tone: 'warn', text: '路线版本缺失，暂不提示',
      }));
      return;
    }

    const base = describeOnVersion(obs.association, rv);
    if (!base) {
      // 身份消失：version-stale。先取确认时版本的旧描述作为历史，明确禁止沿用旧坐标。
      const oldRv = routes.get(`${routeId}@${obs.association.version}`);
      const oldDesc = oldRv ? describeOnVersion(obs.association, oldRv) : null;
      const re = recomputeForVersion(obs.association, oldDesc, rv);
      advisories.push(makeAdvisory(obs, 'version-stale', null, {
        kind: 'version-stale', tone: 'warn',
        text: re.reason,
        lastGoodVersion: re.lastGoodVersion,
        lastGoodMileage: re.lastGoodMileage,
        lastGoodPoint: re.lastGoodPoint,
      }));
      return;
    }

    const migrated = activeVersion !== obs.association.version;
    const kindByState = {
      active: { kind: 'hazard', tone: 'danger' },
      'stale-construction': { kind: 'needs-update', tone: 'warn' },
      upcoming: { kind: 'upcoming', tone: 'info' },
      expired: { kind: 'expired', tone: 'muted' },
    }[state] ?? { kind: 'hazard', tone: 'danger' };

    advisories.push(makeAdvisory(obs, state, {
      ...base,
      routeVersion: rv.version,
      routeName: rv.name,
      direction: rv.direction,
      migratedFromVersion: migrated ? obs.association.version : null,
      staleCoordinates: false,
    }, kindByState));
  });
  // 稳定排序：按路线、起里程；交叠区间各自保留。
  advisories.sort((a, b) => {
    const ra = a.segment?.routeId ?? ''; const rb = b.segment?.routeId ?? '';
    if (ra !== rb) return ra < rb ? -1 : 1;
    return (a.segment?.fromMeter ?? -1) - (b.segment?.fromMeter ?? -1);
  });
  return advisories;
}

function makeAdvisory(obs, state, segment, extra) {
  return {
    observationId: obs.id,
    routeId: obs.association?.routeId ?? null,
    type: obs.type,
    construction: obs.construction,
    source: obs.source,
    observedAt: obs.observedAt,
    startAt: obs.startAt,
    endAt: obs.endAt,
    note: obs.note,
    state,
    segment,
    ...extra,
  };
}

// ---------- 应用状态容器 ----------
export class AppStore {
  constructor({ routes, observations, now, activeVersions = {}, storage = null }) {
    this.routes = routes;                       // Map: routeId@version -> RouteVersion
    this.observations = observations;
    this.now = now;
    this.activeVersions = activeVersions;
    this.storage = storage;
    refreshCandidates(this.observations, this.routes);
  }

  static seed(now, storage = null) {
    // 延迟引入 seed 工厂，保持本模块在测试中的纯粹性。
    const { buildSeedRoutes, buildSeedObservations } = seedFactories();
    const routeMap = new Map(Object.entries(buildSeedRoutes()));
    const observations = buildSeedObservations();
    const activeVersions = {};
    routeMap.forEach((rv) => {
      activeVersions[rv.routeId] = Math.max(activeVersions[rv.routeId] ?? 0, rv.version);
    });
    const store = new AppStore({ routes: routeMap, observations, now, activeVersions, storage });
    preseedConfirmations(store, now);
    return store;
  }

  setActiveVersion(routeId, version) { this.activeVersions[routeId] = version; }
  advisories() { return buildAdvisories(this.observations, this.routes, this.activeVersions, this.now); }
}

function seedFactories() {
  // eslint-disable-next-line global-require
  return require_seed();
}

import { buildSeedRoutes, buildSeedObservations } from './model.js';
function require_seed() { return { buildSeedRoutes, buildSeedObservations }; }

// 预置确认：O1→桥面 D1（identity），O2/O3→人工纠错，O4/O5/O7/O8/O9 体现各语义。
function preseedConfirmations(store, now) {
  const by = (id) => store.observations.find((o) => o.id === id);

  let o = by('O1');
  confirmCandidate(o, o.candidates.find((c) => c.segmentId === 'D1'), { at: now, by: '值班编辑' });

  o = by('O2');
  {
    const rv = store.routes.get('R-under@1');
    const seg = rv.segments.find((s) => s.segmentId === 'U1');
    manualConfirmSegment(o, rv, seg, { at: now, by: '值班编辑' });
  }

  o = by('O3');
  {
    const rv = store.routes.get('R-fold@1');
    const seg = rv.segments.find((s) => s.segmentId === 'F3');
    manualConfirmSegment(o, rv, seg, { at: now, by: '值班编辑' });
  }

  o = by('O4');
  confirmCandidate(o, o.candidates.find((c) => c.segmentId === 'S2'), { at: now, by: '值班编辑' });

  o = by('O5');
  confirmCandidate(o, o.candidates.find((c) => c.segmentId === 'S3'), { at: now, by: '值班编辑' });

  // O6 保持 pending：交叠场景下编辑尚未确认第二条记录 → 前端不提示，后台可见候选。

  o = by('O7');
  confirmCandidate(o, o.candidates.find((c) => c.segmentId === 'S1'), { at: '2026-08-06T10:00:00+08:00', by: '值班编辑' });

  o = by('O8');
  confirmCandidate(o, o.candidates.find((c) => c.segmentId === 'S4'), { at: '2026-08-21T10:00:00+08:00', by: '值班编辑' });
  addRevisit(o, { at: '2026-09-15T10:00:00+08:00', conclusion: 'absent', by: '回访员A', note: '现场便桥已拓宽，无窄桥问题' });

  o = by('O9');
  confirmCandidate(o, o.candidates.find((c) => c.segmentId === 'S4'), { at: '2026-07-12T10:00:00+08:00', by: '值班编辑' });
  addRevisit(o, { at: '2026-09-01T10:00:00+08:00', conclusion: 'cleared', by: '回访员A', note: '坡道已改造完成' });
}
