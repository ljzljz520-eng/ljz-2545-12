// 视图模型：把领域状态转成“地图层 + 可读列表”所需的纯数据，
// 不含 DOM，Node 下可直接断言无障碍与范围属性。

import { HAZARD_TYPES } from './model.js';
import { STATE_LABELS } from './advisory.js';
import { mileageForDirection } from './route.js';

export const TONE_LABEL = {
  danger: '需要注意',
  warn: '需要核实',
  info: '预告',
  muted: '历史信息',
  ok: '已解决',
};

/**
 * 构建视图模型。
 * @param advisories buildAdvisories 结果
 * @param routes Map
 * @param opts {{travelDirection?: 'forward'|'reverse', routeFilter?: string}}
 */
export function buildViewModel(advisories, routes, opts = {}) {
  const travelDirection = opts.travelDirection ?? 'forward';

  const listItems = advisories.map((adv) => {
    const meta = STATE_LABELS[adv.state] ?? { text: adv.state, tone: 'muted' };
    let loc = null;
    if (adv.segment) {
      const rv = routes.get(`${adv.segment.routeId}@${adv.segment.routeVersion}`);
      const m = mileageForDirection(adv.segment, rv, travelDirection);
      loc = {
        anchor: `${adv.observationId}@${adv.segment.segmentKey}`, // 地图↔列表同一锚点
        routeId: adv.segment.routeId,
        routeName: adv.segment.routeName,
        routeVersion: adv.segment.routeVersion,
        direction: travelDirection,
        segmentKey: adv.segment.segmentKey,
        segmentIndex: adv.segment.segmentIndex,
        fromMeter: round1(m.fromMeter),
        toMeter: round1(m.toMeter),
        centerMileage: round1(m.centerMileage),
        migratedFromVersion: adv.segment.migratedFromVersion,
      };
    }
    return {
      routeId: adv.routeId,
      anchor: loc ? loc.anchor : `${adv.observationId}@unlocated`,
      observationId: adv.observationId,
      typeLabel: HAZARD_TYPES[adv.type]?.label ?? adv.type,
      typeIcon: HAZARD_TYPES[adv.type]?.icon ?? '⚠️',
      stateText: meta.text,
      tone: meta.tone,
      toneLabel: TONE_LABEL[meta.tone] ?? '',
      construction: adv.construction,
      source: adv.source,
      observedAt: adv.observedAt,
      startAt: adv.startAt,
      endAt: adv.endAt,
      note: adv.note,
      kind: adv.kind,
      text: adv.text ?? null,
      location: loc,
      lastGood: adv.lastGoodVersion
        ? { version: adv.lastGoodVersion, mileage: round1(adv.lastGoodMileage), point: adv.lastGoodPoint }
        : null,
    };
  });

  // 地图层：每条路线只点亮含提示的段，其余段保持中性底色（不扩散到全线）。
  const mapLayers = buildMapLayers(advisories, routes);
  return { listItems, mapLayers, generatedAt: new Date().toISOString() };
}

function buildMapLayers(advisories, routes) {
  const layers = [];
  routes.forEach((rv) => {
    const touched = new Map(); // segmentKey -> [advisory...]
    advisories.forEach((adv) => {
      if (adv.segment && adv.segment.routeId === rv.routeId && adv.segment.routeVersion === rv.version) {
        const arr = touched.get(adv.segment.segmentKey) ?? [];
        arr.push(adv);
        touched.set(adv.segment.segmentKey, arr);
      }
    });
    const segments = rv.segments.map((seg) => {
      const key = `${seg.roadCode}|${seg.level}|${seg.segmentId}`;
      const ads = touched.get(key);
      return {
        segmentKey: key,
        order: seg.order,
        coords: seg.coords,
        level: seg.level,
        affected: !!ads,
        tone: ads ? worstTone(ads.map((a) => STATE_LABELS[a.state]?.tone ?? 'muted')) : null,
        anchors: ads ? ads.map((a) => `${a.observationId}@${key}`) : [],
        observationIds: ads ? ads.map((a) => a.observationId) : [],
      };
    });
    layers.push({
      routeId: rv.routeId,
      version: rv.version,
      name: rv.name,
      direction: rv.direction,
      level: rv.segments[0]?.level ?? 0,
      segments,
      affectedCount: segments.filter((s) => s.affected).length,
      totalCount: segments.length,
    });
  });
  layers.sort((a, b) => a.routeId.localeCompare(b.routeId));
  return layers;
}

const TONE_ORDER = { danger: 0, warn: 1, info: 2, ok: 3, muted: 4 };
function worstTone(tones) {
  return tones.sort((x, y) => (TONE_ORDER[x] ?? 9) - (TONE_ORDER[y] ?? 9))[0];
}
function round1(n) { return Math.round(n * 10) / 10; }
