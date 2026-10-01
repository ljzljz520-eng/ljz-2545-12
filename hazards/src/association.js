// 自动关联：观察点 → 路段候选。
//
// 设计原则：
// 1. 点到折线的最近投影可能落在桥下道路、桥面道路或折返的另一段，
//    几何最近 ≠ 真实路段；因此自动阶段只产出“候选 + 距离依据”，绝不直接采信。
// 2. 两类证据分层：
//    - identity（基于道路段身份）：观察记录携带稳定身份 (roadCode,level,segmentId)，
//      且候选段身份一致——身份证据优先，即使它不是平面最近点。
//    - buffer（圆形缓冲匹配）：投影距离落在观察点缓冲半径内。
// 3. 候选保留同一投影点、层级、距离、里程、缓冲内/外等全部依据，供人工纠错。

import { projectOnSegment, polylineLength } from './geometry.js';

export function segmentKey(seg) {
  return `${seg.roadCode}|${seg.level}|${seg.segmentId}`;
}

export function parseSegmentKey(key) {
  const [roadCode, level, segmentId] = key.split('|');
  return { roadCode, level: Number(level), segmentId };
}

/** 在指定路线版本中按稳定身份找段；身份消失时返回 null（由调用方置 version-stale）。 */
export function findSegmentInVersion(routeVersion, roadCode, level, segmentId) {
  return routeVersion.segments.find(
    (s) => s.roadCode === roadCode && s.level === level && s.segmentId === segmentId,
  ) ?? null;
}

/**
 * 观察点投影到单条路线版本的全部路段，返回候选（按 身份优先→距离 排序）。
 */
export function projectToVersion(observation, routeVersion) {
  // 该版本起算里程：每段起点距路线起点的累计长度；多点段按内部折线逐段投影。
  let cumulative = 0;
  const candidates = routeVersion.segments.map((seg) => {
    const proj = nearestOnSegmentCoords(observation.point, seg.coords);
    const roadCodeMatch = !!observation.roadCode && observation.roadCode === seg.roadCode;
    const sameLevel = observation.level === seg.level;
    const segmentIdMatch = roadCodeMatch && sameLevel && !!observation.segmentId && observation.segmentId === seg.segmentId;
    const withinRadius = proj.distance <= observation.radius;
    const segLen = polylineLength(seg.coords);
    const mileage = cumulative + proj.sAlong;
    cumulative += segLen;
    return {
      routeId: routeVersion.routeId,
      version: routeVersion.version,
      routeName: routeVersion.name,
      direction: routeVersion.direction,
      segmentKey: segmentKey(seg),
      roadCode: seg.roadCode,
      level: seg.level,
      segmentId: seg.segmentId,
      segmentIndex: seg.order,
      t: proj.t,
      projectedPoint: proj.point,
      distance: proj.distance,
      sameLevel,
      roadCodeMatch,
      segmentIdMatch,
      withinRadius,
      tier: segmentIdMatch ? 'identity' : 'buffer',
      mileage,
    };
  });

  const kept = candidates.filter((c) => c.segmentIdMatch || c.withinRadius);
  kept.sort((c1, c2) => {
    if (c1.segmentIdMatch !== c2.segmentIdMatch) return c1.segmentIdMatch ? -1 : 1;
    const lv = (c) => (c.tier === 'identity' ? 0 : 1);
    if (lv(c1) !== lv(c2)) return lv(c1) - lv(c2);
    return c1.distance - c2.distance;
  });
  return kept;
}

/**
 * 路网范围匹配：对一组路线版本生成候选。
 * 返回 { byVersion: MapKey→candidates[], all: [...] }。
 */
export function matchAcrossNetwork(observation, routeVersions) {
  const all = [];
  routeVersions.forEach((rv) => {
    all.push(...projectToVersion(observation, rv));
  });
  all.sort((c1, c2) => {
    if (c1.segmentIdMatch !== c2.segmentIdMatch) return c1.segmentIdMatch ? -1 : 1;
    if (c1.tier !== c2.tier) return c1.tier === 'identity' ? -1 : 1;
    return c1.distance - c2.distance;
  });
  return all;
}

/** 自动建议的“最佳候选”——仅为默认选项，仍需人工确认。 */
export function suggestBest(candidates) {
  return candidates[0] ?? null;
}


// 多点道路段上的最近投影，返回段内累计里程 sAlong。
function nearestOnSegmentCoords(point, coords) {
  let best = null;
  let offset = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const proj = projectOnSegment(point, a, b);
    if (!best || proj.distance < best.distance) {
      best = { t: proj.t, point: proj.point, distance: proj.distance, sAlong: offset + proj.t * segLen };
    }
    offset += segLen;
  }
  return best;
}
