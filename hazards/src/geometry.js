// 路口提示服务 —— 几何基础
// 平面坐标单位约定为“米”，level 表示竖向层（0 地面 / 1 高架 / -1 地下）。
// 点到折线的最近投影可能落在“桥下道路、桥上另一条路或折返的另一段”，
// 因此本模块只负责给出候选投影（含层级、距离、投影点），
// 是否采用由关联模块分层排序、由人工编辑确认，几何层不做任何自动采信。

/**
 * 点 P 到线段 AB 的最近点投影。
 * 返回投影参数 t（0..1 落在段内，否则夹到端点）、投影点与平面距离。
 */
export function projectOnSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : (apx * abx + apy * aby) / len2;
  const tRaw = t;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * abx;
  const y = a[1] + t * aby;
  return {
    t,
    tRaw,
    inside: tRaw >= 0 && tRaw <= 1,
    point: [x, y],
    distance: Math.hypot(p[0] - x, p[1] - y),
  };
}

/**
 * 点到折线（坐标数组）的最近投影：逐段比较，保留所有“最近并列候选”。
 * 同一点在平面上可能等距于多个段（桥下/桥上、折返段），
 * 所以返回按距离升序的候选数组，而不是单个结果。
 */
export function nearestOnPolyline(point, coords) {
  const candidates = coords.slice(0, -1).map((a, i) => {
    const b = coords[i + 1];
    const seg = projectOnSegment(point, a, b);
    return {
      segmentIndex: i,
      ...seg,
    };
  });
  candidates.sort((c1, c2) => c1.distance - c2.distance);
  return candidates;
}

/** 折线累计长度（米）。 */
export function polylineLength(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    total += Math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]);
  }
  return total;
}

/**
 * 沿折线在指定里程（米）处的位置。
 * M 超过起终点时夹到端点并标记 clamped，调用方据此发现异常而不是静默外推。
 */
export function locateAlong(coords, mileage) {
  let remaining = mileage;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= segLen || i === coords.length - 2) {
      const t = segLen === 0 ? 0 : Math.max(0, Math.min(1, remaining / segLen));
      return {
        segmentIndex: i,
        t,
        point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
        clamped: mileage < 0 || mileage > polylineLength(coords),
      };
    }
    remaining -= segLen;
  }
  const last = coords[coords.length - 1];
  return { segmentIndex: coords.length - 2, t: 1, point: [...last], clamped: true };
}

/** 两点间平面距离。 */
export function distance2D(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
