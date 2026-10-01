// 路线版本与里程重算。
//
// 铁律：里程位置是“版本派生值”。改线后沿新版本重新计算；
// 若确认时的路段身份在新版本中消失，关联置为 version-stale，
// 保留旧版本里程与旧投影点作为历史，绝不悄悄改坐标。

import { findSegmentInVersion } from './association.js';
import { locateAlong } from './geometry.js';

export function routeVersionKey(routeId, version) {
  return `${routeId}@${version}`;
}

/**
 * 沿某版本几何，给出确认关联的里程描述。
 * 返回 null 表示该身份在此版本不存在（调用方应置 stale）。
 */
export function describeOnVersion(association, routeVersion) {
  const seg = findSegmentInVersion(
    routeVersion,
    association.roadCode,
    association.level,
    association.segmentId,
  );
  if (!seg) return null;

  // 从版本起点累计到该段。
  let start = 0;
  for (const s of routeVersion.segments) {
    if (s === seg) break;
    start += polySegLen(s.coords);
  }
  const segLen = polySegLen(seg.coords);
  const center = start + segLen / 2;
  const loc = locateAlong(routeVersion.coords, center);
  const half = association.impactMeters / 2;
  const fromM = Math.max(0, center - half);
  const toM = Math.min(routeVersion.length, center + half);
  return {
    routeId: routeVersion.routeId,
    version: routeVersion.version,
    segmentKey: `${seg.roadCode}|${seg.level}|${seg.segmentId}`,
    roadCode: seg.roadCode,
    level: seg.level,
    segmentId: seg.segmentId,
    segmentIndex: seg.order,
    centerMileage: center,
    fromMeter: fromM,
    toMeter: toM,
    point: loc.point,
  };
}

/**
 * 把既有 confirmed 关联迁移到新版本。
 * - 身份保留：里程按新几何重算（坐标自然变化，有版本依据，不算漂移）。
 * - 身份消失：返回 {status:'version-stale'}，保留旧描述不动。
 */
export function recomputeForVersion(association, oldDescription, newRouteVersion) {
  const next = describeOnVersion(association, newRouteVersion);
  if (!next) {
    return {
      status: 'version-stale',
      lastGoodVersion: oldDescription?.version ?? association.version,
      lastGoodMileage: oldDescription?.centerMileage ?? association.mileage,
      lastGoodPoint: oldDescription?.point ?? association.projectedPoint,
      reason: `路段 ${association.roadCode}/${association.segmentId} 在版本 ${newRouteVersion.version} 中不存在`,
    };
  }
  return { status: 'current', description: next };
}

function polySegLen(coords) {
  let t = 0;
  for (let i = 0; i < coords.length - 1; i += 1) t += Math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]);
  return t;
}

/** 双向路线展示用：reverse 方向里程取反算（version.length - m）。 */
export function mileageForDirection(description, routeVersion, travelDirection) {
  if (travelDirection === 'reverse') {
    return {
      centerMileage: routeVersion.length - description.centerMileage,
      fromMeter: routeVersion.length - description.toMeter,
      toMeter: routeVersion.length - description.fromMeter,
    };
  }
  return {
    centerMileage: description.centerMileage,
    fromMeter: description.fromMeter,
    toMeter: description.toMeter,
  };
}
