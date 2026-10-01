-- =============================================================================
-- 慢行网站 · 路口提示服务 —— PostGIS 空间库结构
--
-- 设计要点（对应业务约束）：
-- 1. 道路段身份 road_segments 与版本几何 route_version_segments 分离：
--    改线只产生新版本几何，身份键 (road_code, level, seg_id) 稳定；
--    里程是版本派生值，沿版本几何重算，身份消失则关联置 stale，禁止沿用旧坐标。
-- 2. 观察点自动关联候选 observation_match_candidates 全量留痕（含层级、距离、
--    投影点、匹配方法），只有 observation_segment_links.status='confirmed'
--    的关联才参与对用户的提示视图 v_active_advisories。
-- 3. 有效区间 [valid_from, valid_to] 与施工标志 construction：
--    construction 且过期 = stale_construction（信息待更新），不等于现场安全；
--    回访 observation_revisits.conclusion='absent' 立即压制提示，
--    只有 'cleared' 代表现场确认恢复。
-- 4. 同一受影响段有效期交叠的记录各自保留（不做去重吞并）。
-- 坐标系：演示为平面米制 SRID=3857（正式环境应使用本地投影，如 CGCS2000 高斯带）。
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------- 路线 ----------
CREATE TABLE routes (
    route_id      TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    direction     TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('forward','reverse','both')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE route_versions (
    route_id      TEXT NOT NULL REFERENCES routes(route_id),
    version       INTEGER NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT FALSE,
    published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    note          TEXT,
    PRIMARY KEY (route_id, version)
);
-- 每条路线至多一个启用版本
CREATE UNIQUE INDEX uq_one_active_version
    ON route_versions(route_id) WHERE is_active;

-- ---------- 稳定路段身份（跨版本） ----------
CREATE TABLE road_segments (
    road_code     TEXT NOT NULL,
    level         INTEGER NOT NULL,             -- 0 地面 / 1 高架 / -1 地下
    seg_id        TEXT NOT NULL,
    name          TEXT,
    PRIMARY KEY (road_code, level, seg_id)
);

-- ---------- 版本几何：身份在版本中的具体形状与顺序 ----------
CREATE TABLE route_version_segments (
    route_id      TEXT NOT NULL,
    version       INTEGER NOT NULL,
    seg_order     INTEGER NOT NULL,
    road_code     TEXT NOT NULL,
    level         INTEGER NOT NULL,
    seg_id        TEXT NOT NULL,
    geom          GEOMETRY(LINESTRING, 3857) NOT NULL,
    PRIMARY KEY (route_id, version, seg_order),
    FOREIGN KEY (route_id, version) REFERENCES route_versions(route_id, version),
    FOREIGN KEY (road_code, level, seg_id) REFERENCES road_segments(road_code, level, seg_id)
);
CREATE INDEX idx_rvs_geom ON route_version_segments USING GIST (geom);
CREATE INDEX idx_rvs_identity ON route_version_segments(road_code, level, seg_id);

-- 版本整线（用于里程起算与可视化）
CREATE TABLE route_version_geoms (
    route_id      TEXT NOT NULL,
    version       INTEGER NOT NULL,
    geom          GEOMETRY(LINESTRING, 3857) NOT NULL,
    length_m      DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (route_id, version),
    FOREIGN KEY (route_id, version) REFERENCES route_versions(route_id, version)
);
CREATE INDEX idx_rvg_geom ON route_version_geoms USING GIST (geom);

-- ---------- 观察点（坡道/窄桥/照明记录） ----------
CREATE TABLE observations (
    id              TEXT PRIMARY KEY,
    hazard_type     TEXT NOT NULL CHECK (hazard_type IN ('ramp','narrow_bridge','lighting')),
    point           GEOMETRY(POINT, 3857) NOT NULL,
    level           INTEGER NOT NULL DEFAULT 0,
    buffer_radius_m DOUBLE PRECISION NOT NULL DEFAULT 25,  -- 圆形缓冲匹配半径
    impact_m        DOUBLE PRECISION NOT NULL DEFAULT 20,  -- 影响范围（沿确认段前后）
    source          TEXT NOT NULL,
    observed_at     TIMESTAMPTZ NOT NULL,                 -- 信息/观察时点
    valid_from      TIMESTAMPTZ NOT NULL,
    valid_to        TIMESTAMPTZ,                          -- NULL = 长期
    construction    BOOLEAN NOT NULL DEFAULT FALSE,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_obs_point ON observations USING GIST (point);

-- ---------- 自动关联候选（全部留痕，含距离依据） ----------
CREATE TABLE observation_match_candidates (
    id                BIGSERIAL PRIMARY KEY,
    observation_id    TEXT NOT NULL REFERENCES observations(id),
    route_id          TEXT NOT NULL,
    version           INTEGER NOT NULL,
    road_code         TEXT NOT NULL,
    level             INTEGER NOT NULL,
    seg_id            TEXT NOT NULL,
    match_method      TEXT NOT NULL CHECK (match_method IN ('identity','buffer')),
    same_level        BOOLEAN NOT NULL,
    distance_m        DOUBLE PRECISION NOT NULL,         -- 观察点→候选段投影距离
    within_buffer     BOOLEAN NOT NULL,
    projected_point   GEOMETRY(POINT, 3857) NOT NULL,
    mileage_m         DOUBLE PRECISION NOT NULL,         -- 在该版本上的投影里程
    computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (route_id, version) REFERENCES route_versions(route_id, version),
    FOREIGN KEY (road_code, level, seg_id) REFERENCES road_segments(road_code, level, seg_id)
);
CREATE INDEX idx_cand_obs ON observation_match_candidates(observation_id);
-- 同一观察点对同一路线版本同段只保留最新一组候选（可改为软删除留痕）
CREATE UNIQUE INDEX uq_cand ON observation_match_candidates(observation_id, route_id, version, road_code, level, seg_id);

-- ---------- 人工确认/纠错后的路段关联（只有 confirmed 才提示） ----------
CREATE TABLE observation_segment_links (
    observation_id    TEXT PRIMARY KEY REFERENCES observations(id),
    route_id          TEXT NOT NULL,
    version           INTEGER NOT NULL,                  -- 确认时所依据的版本
    road_code         TEXT NOT NULL,
    level             INTEGER NOT NULL,
    seg_id            TEXT NOT NULL,
    link_method       TEXT NOT NULL CHECK (link_method IN ('auto','manual')), -- manual=人工纠错
    evidence_distance_m DOUBLE PRECISION NOT NULL,
    evidence_note     TEXT,
    impact_m          DOUBLE PRECISION NOT NULL,
    status            TEXT NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('confirmed','rejected','version_stale')),
    confirmed_by      TEXT NOT NULL,
    confirmed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (route_id, version) REFERENCES route_versions(route_id, version),
    FOREIGN KEY (road_code, level, seg_id) REFERENCES road_segments(road_code, level, seg_id)
);

-- ---------- 回访（否定旧记录 / 确认恢复） ----------
CREATE TABLE observation_revisits (
    id              BIGSERIAL PRIMARY KEY,
    observation_id  TEXT NOT NULL REFERENCES observations(id),
    revisited_at    TIMESTAMPTZ NOT NULL,
    conclusion      TEXT NOT NULL CHECK (conclusion IN ('present','absent','cleared')),
    by_user         TEXT NOT NULL,
    note            TEXT,
    UNIQUE (observation_id, revisited_at)
);
CREATE INDEX idx_revisit_obs ON observation_revisits(observation_id, revisited_at DESC);

-- =============================================================================
-- 提示视图：仅 confirmed 关联；交叠记录各自成行；stale/过期语义由状态列表达。
-- 状态优先级：cleared/negated（被最新回访压制，视图中不出现）> active
-- > stale_construction（施工过期待更新）> expired（普通过期）> upcoming（未生效）。
-- 受影响里程区间按“当前启用版本”即时计算（见下方函数），
-- 因此改线后输出自动跟随新版本；身份消失的关联标记 version_stale 且不输出里程。
-- =============================================================================
CREATE OR REPLACE FUNCTION seg_span_on_active_version(
    p_route_id TEXT, p_road_code TEXT, p_level INTEGER, p_seg_id TEXT,
    p_impact_m DOUBLE PRECISION,
    OUT route_version INTEGER,
    OUT seg_order INTEGER,
    OUT from_m DOUBLE PRECISION,
    OUT to_m DOUBLE PRECISION,
    OUT found BOOLEAN
) LANGUAGE plpgsql AS $$
DECLARE
    v_version INTEGER;
    v_start   DOUBLE PRECISION;
    v_len     DOUBLE PRECISION;
    v_total   DOUBLE PRECISION;
    v_order   INTEGER;
BEGIN
    SELECT version INTO v_version FROM route_versions WHERE route_id = p_route_id AND is_active;
    SELECT ST_Length(geom) INTO v_total FROM route_version_geoms
      WHERE route_id = p_route_id AND version = v_version;
    SELECT COALESCE(SUM(ST_Length(rvs.geom)), 0)
      INTO v_start
      FROM route_version_segments rvs
      WHERE rvs.route_id = p_route_id AND rvs.version = v_version
        AND rvs.seg_order < (
          SELECT seg_order FROM route_version_segments
           WHERE route_id = p_route_id AND version = v_version
             AND road_code = p_road_code AND level = p_level AND seg_id = p_seg_id);
    SELECT ST_Length(geom), seg_order INTO v_len, v_order
      FROM route_version_segments
      WHERE route_id = p_route_id AND version = v_version
        AND road_code = p_road_code AND level = p_level AND seg_id = p_seg_id;
    IF v_len IS NULL THEN
        found := FALSE; RETURN;
    END IF;
    route_version := v_version;
    seg_order := v_order;
    from_m := GREATEST(0, v_start + v_len/2 - p_impact_m/2);
    to_m := LEAST(v_total, v_start + v_len/2 + p_impact_m/2);
    found := TRUE;
END $$;

CREATE OR REPLACE VIEW v_active_advisories AS
WITH latest_revisit AS (
    SELECT DISTINCT ON (observation_id) observation_id, conclusion
      FROM observation_revisits ORDER BY observation_id, revisited_at DESC
)
SELECT
    o.id              AS observation_id,
    o.hazard_type,
    o.construction,
    o.source,
    o.observed_at,
    o.valid_from,
    o.valid_to,
    l.route_id,
    l.road_code, l.level, l.seg_id,
    l.link_method,
    l.evidence_distance_m,
    span.route_version,
    span.from_m,
    span.to_m,
    CASE
        WHEN l.status = 'version_stale' OR span.found IS FALSE THEN 'version_stale'
        WHEN now() < o.valid_from THEN 'upcoming'
        WHEN o.valid_to IS NOT NULL AND now() > o.valid_to AND o.construction THEN 'stale_construction'
        WHEN o.valid_to IS NOT NULL AND now() > o.valid_to THEN 'expired'
        ELSE 'active'
    END AS advisory_state
FROM observations o
JOIN observation_segment_links l ON l.observation_id = o.id AND l.status = 'confirmed'
LEFT JOIN latest_revisit r ON r.observation_id = o.id
CROSS JOIN LATERAL (
    SELECT (s).route_version, (s).seg_order, (s).from_m, (s).to_m, (s).found
    FROM seg_span_on_active_version(l.route_id, l.road_code, l.level, l.seg_id, l.impact_m) s
) span
WHERE r.conclusion IS DISTINCT FROM 'absent'
  AND r.conclusion IS DISTINCT FROM 'cleared';
-- 注意：version_stale 行 from_m/to_m 为 NULL，前端不得在地图上落点，
-- 只展示“最后有效版本/里程（冻结）+ 待人工重认”。

-- 交叠区间查询示例：同一身份段上有效期相互交叠的记录全部返回、各自成行
-- SELECT * FROM v_active_advisories a
-- WHERE advisory_state IN ('active','stale_construction')
--   AND (road_code, level, seg_id) = ('BJH', 0, 'S2')
-- ORDER BY from_m;
