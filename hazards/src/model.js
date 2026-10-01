// 领域模型与演示数据。
//
// 关键概念：
// - RoadSegment（道路段身份）：跨路线版本稳定的身份键 (roadCode, level, segmentId)。
//   改线后某段几何可以变，但只要身份保留，里程就沿新版本重新计算；
//   身份从版本中消失则关联置为 version-stale（旧坐标不得悄悄漂移）。
// - RouteVersion：某条路线在一个版本下的有序路段，direction 表示建模方向。
// - Observation：观察点（坡道/窄桥/照明记录），含影响范围(米)与有效区间。
// - 关联：auto 产生的全部是 pending 候选（带距离依据），编辑确认后 confirmed 才用于提示。

export const HAZARD_TYPES = {
  ramp: { label: '坡道', icon: '♿' },
  narrow_bridge: { label: '窄桥', icon: '🌉' },
  lighting: { label: '照明', icon: '💡' },
};

export const ASSOC_STATUS = {
  PENDING: 'pending',     // 自动候选，尚未人工确认
  CONFIRMED: 'confirmed', // 编辑确认真实路段，可用于提示
  REJECTED: 'rejected',   // 编辑否认为错误路段
};

/**
 * @param {string} id
 * @param {object} opts {type, point, level, roadCode?, segmentId?, radius,
 *   source, observedAt, startAt, endAt, note, construction}
 */
export function createObservation(id, opts) {
  return {
    id,
    type: opts.type,
    point: opts.point,                 // [x, y]
    level: opts.level ?? 0,
    roadCode: opts.roadCode ?? null,   // 来源上报时附带的道路身份（可能缺失）
    segmentId: opts.segmentId ?? null,
    radius: opts.radius ?? 25,         // 圆形缓冲匹配半径（米）
    impactMeters: opts.impactMeters ?? 20, // 影响范围：确认后沿路段前后延伸的米数
    source: opts.source ?? '志愿者上报',
    observedAt: opts.observedAt,       // 观察时点（信息时点，不是有效期）
    startAt: opts.startAt,             // 有效区间起
    endAt: opts.endAt,                 // 有效区间止（null 表示长期）
    construction: opts.construction ?? false, // 施工类：过期=待更新，不代表现场安全
    note: opts.note ?? '',
    revisits: [],                      // {at, conclusion: 'present'|'absent'|'cleared', by, note}
    candidates: [],                    // 自动关联候选（见 association.js）
    association: null,                 // 人工确认后的关联
  };
}

/** 构造一条路线版本。segments: [{roadCode, level, segmentId, coords}] */
export function createRouteVersion(routeId, version, opts = {}) {
  const segments = opts.segments.map((s, i) => ({
    roadCode: s.roadCode,
    level: s.level ?? 0,
    segmentId: s.segmentId,
    coords: s.coords,
    order: i,
  }));
  const coords = segments.flatMap((s, i) => (i === 0 ? s.coords : s.coords.slice(1)));
  return {
    routeId,
    version,
    name: opts.name ?? routeId,
    direction: opts.direction ?? 'forward', // forward | reverse | both
    segments,
    coords,
    length: polyLen(coords),
  };
}

function polyLen(coords) {
  let t = 0;
  for (let i = 0; i < coords.length - 1; i += 1) t += Math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]);
  return t;
}

// ---------------------------------------------------------------------------
// 演示数据：固定“当前时刻”，使有效期/过期语义可复现。
// ---------------------------------------------------------------------------
export const NOW = '2026-10-01T09:00:00+08:00';

/** 滨河南路 v1：地面层四个稳定身份段。 */
function binheV1() {
  return createRouteVersion('R-binhe', 1, {
    name: '滨河南路慢行线',
    direction: 'both',
    segments: [
      { roadCode: 'BJH', level: 0, segmentId: 'S1', coords: [[0, 120], [100, 120]] },
      { roadCode: 'BJH', level: 0, segmentId: 'S2', coords: [[100, 120], [200, 120]] },
      { roadCode: 'BJH', level: 0, segmentId: 'S3', coords: [[200, 120], [300, 120]] },
      { roadCode: 'BJH', level: 0, segmentId: 'S4', coords: [[300, 120], [400, 120]] },
    ],
  });
}

/** 滨河南路 v2（改线）：S2 局部绕行（身份保留、几何变化）；S3 被取消（身份消失）。 */
function binheV2() {
  return createRouteVersion('R-binhe', 2, {
    name: '滨河南路慢行线',
    direction: 'both',
    segments: [
      { roadCode: 'BJH', level: 0, segmentId: 'S1', coords: [[0, 120], [100, 120]] },
      { roadCode: 'BJH', level: 0, segmentId: 'S2', coords: [[100, 120], [150, 100], [200, 120]] },
      { roadCode: 'BJH', level: 0, segmentId: 'S4', coords: [[200, 120], [300, 120], [400, 120]] },
    ],
  });
}

/** 北环跨线桥（level 1）与正下方地面道路（level 0）平面重合。 */
function bridgeRoutes() {
  const bridge = createRouteVersion('R-bridge', 1, {
    name: '北环跨线桥（桥面）',
    direction: 'forward',
    segments: [
      { roadCode: 'BRD', level: 1, segmentId: 'D1', coords: [[60, 300], [160, 300], [260, 300]] },
    ],
  });
  const under = createRouteVersion('R-under', 1, {
    name: '桥下地面路',
    direction: 'forward',
    segments: [
      { roadCode: 'UND', level: 0, segmentId: 'U1', coords: [[60, 302], [260, 302]] },
    ],
  });
  return { bridge, under };
}

/** 环山步道：折返形，平面上两个不同段在同一带内，投影可能落错。 */
function foldedRoute() {
  return createRouteVersion('R-fold', 1, {
    name: '环山步道（折返段）',
    direction: 'both',
    segments: [
      { roadCode: 'FLD', level: 0, segmentId: 'F1', coords: [[40, 420], [160, 420]] },
      { roadCode: 'FLD', level: 0, segmentId: 'F2', coords: [[160, 420], [160, 480]] },
      { roadCode: 'FLD', level: 0, segmentId: 'F3', coords: [[160, 480], [60, 480]] }, // 折返，与 F1 平面平行贴近
    ],
  });
}

export function buildSeedRoutes() {
  const { bridge, under } = bridgeRoutes();
  return {
    'R-binhe@1': binheV1(),
    'R-binhe@2': binheV2(),
    'R-bridge@1': bridge,
    'R-under@1': under,
    'R-fold@1': foldedRoute(),
  };
}

export function buildSeedObservations() {
  return [
    // 1) 桥上观察点：平面投影同时贴近桥面 D1 与桥下 U1。
    createObservation('O1', {
      type: 'narrow_bridge', point: [150, 300], level: 1,
      roadCode: 'BRD', segmentId: 'D1', radius: 20, impactMeters: 30,
      source: '巡检 2026-09-20', observedAt: '2026-09-20T10:00:00+08:00',
      startAt: '2026-09-21T00:00:00+08:00', endAt: '2026-11-30T23:59:59+08:00',
      note: '桥面净宽 1.2m，轮椅需推行协助',
    }),
    // 2) 桥下观察点：自动缓冲会误配到桥面 D1（层级不同），需人工纠错到 U1。
    createObservation('O2', {
      type: 'ramp', point: [150, 300], level: 0,
      radius: 12, impactMeters: 18,
      source: '轮椅用户回访', observedAt: '2026-09-25T18:30:00+08:00',
      startAt: '2026-09-26T00:00:00+08:00', endAt: '2026-12-31T23:59:59+08:00',
      note: '桥下出入口坡道较陡',
    }),
    // 3) 折返步道：投影可能落到来向 F1，真实段是折返段 F3。
    createObservation('O3', {
      type: 'lighting', point: [60, 450], level: 0,
      radius: 65, impactMeters: 40,
      source: '居民上报', observedAt: '2026-09-28T20:00:00+08:00',
      startAt: '2026-09-28T00:00:00+08:00', endAt: null,
      note: '折返段夜间无灯',
    }),
    // 4) 滨河 S2 照明：v2 几何改变但身份保留 → 里程重算、坐标不漂移。
    createObservation('O4', {
      type: 'lighting', point: [150, 120], level: 0,
      roadCode: 'BJH', segmentId: 'S2', radius: 15, impactMeters: 25,
      source: '市政台账', observedAt: '2026-09-15T09:00:00+08:00',
      startAt: '2026-09-15T00:00:00+08:00', endAt: null,
      note: 'S2 段照度不足（长期记录）',
    }),
    // 5) 滨河 S3 坡道：S3 在 v2 中被取消 → version-stale，禁止沿用旧坐标。
    createObservation('O5', {
      type: 'ramp', point: [250, 120], level: 0,
      roadCode: 'BJH', segmentId: 'S3', radius: 15, impactMeters: 20,
      source: '志愿者上报', observedAt: '2026-09-10T09:00:00+08:00',
      startAt: '2026-09-10T00:00:00+08:00', endAt: null,
      note: '原 S3 段缘石坡道缺失',
    }),
    // 6) 与 O4 有效期交叠的第二条 S2 记录（交叠不得互相吞掉）。
    createObservation('O6', {
      type: 'ramp', point: [160, 120], level: 0,
      roadCode: 'BJH', segmentId: 'S2', radius: 15, impactMeters: 15,
      source: '施工告示', observedAt: '2026-09-29T08:00:00+08:00',
      startAt: '2026-09-29T00:00:00+08:00', endAt: '2026-10-15T23:59:59+08:00',
      construction: true,
      note: 'S2 交叉口临时坡道钢板',
    }),
    // 7) 施工已过期：语义为“信息待更新”，不等于现场安全。
    createObservation('O7', {
      type: 'ramp', point: [60, 120], level: 0,
      roadCode: 'BJH', segmentId: 'S1', radius: 15, impactMeters: 20,
      source: '施工告示', observedAt: '2026-08-01T08:00:00+08:00',
      startAt: '2026-08-05T00:00:00+08:00', endAt: '2026-09-01T23:59:59+08:00',
      construction: true,
      note: 'S1 施工围挡占用坡道（公示 9/1 结束，未见回访）',
    }),
    // 8) 已被回访否定（absent）：旧记录保留，但不再提示。
    createObservation('O8', {
      type: 'narrow_bridge', point: [350, 120], level: 0,
      roadCode: 'BJH', segmentId: 'S4', radius: 15, impactMeters: 20,
      source: '历史上报', observedAt: '2026-08-20T09:00:00+08:00',
      startAt: '2026-08-20T00:00:00+08:00', endAt: null,
      note: '曾报 S4 便桥狭窄',
    }),
  // 9) 已回访确认清除（cleared）：现场恢复安全，归档。
    createObservation('O9', {
      type: 'ramp', point: [300, 120], level: 0,
      roadCode: 'BJH', segmentId: 'S4', radius: 15, impactMeters: 20,
      source: '历史上报', observedAt: '2026-07-10T09:00:00+08:00',
      startAt: '2026-07-10T00:00:00+08:00', endAt: null,
      note: '曾报 S4 端部坡度过大',
    }),
  ].map((o) => ({ ...o, __seed: true }));
}
