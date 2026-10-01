/* 演示路线、观察点与空间数据库字段说明。生产环境由 API/PostGIS 提供。 */
(function (root) {
    'use strict';

    const v2025 = CrossingCore.prepareRoute({
        id: 'route-v2025',
        version: 'v2025-归档',
        name: '滨河慢行线（旧线）',
        effectiveAt: '2025-01-01T00:00:00+08:00',
        supersededAt: '2026-01-01T00:00:00+08:00',
        segments: [
            { id: 'v25-OB1', sequence: 1, direction: 'outbound', roadIdentity: 'RAMP-E', name: '东向坡道（旧）', level: 'surface', elevation: 0, from: [80, 340], to: [180, 300] },
            { id: 'v25-OB2', sequence: 2, direction: 'outbound', roadIdentity: 'RIVER-BRIDGE', name: '河滨桥（旧）', level: 'surface', elevation: 0, from: [180, 300], to: [340, 260] },
            { id: 'v25-OB3', sequence: 3, direction: 'outbound', roadIdentity: 'STATION-LINK', name: '车站联系段（旧）', level: 'surface', elevation: 0, from: [340, 260], to: [520, 260] },
            { id: 'v25-OB4', sequence: 4, direction: 'outbound', roadIdentity: 'EAST-APPROACH', name: '东端接入口（旧）', level: 'surface', elevation: 0, from: [520, 260], to: [650, 300] },

            { id: 'v25-IN1', sequence: 1, direction: 'inbound', roadIdentity: 'EAST-APPROACH', name: '东端接入口（旧）', level: 'surface', elevation: 0, from: [650, 360], to: [520, 320] },
            { id: 'v25-IN2', sequence: 2, direction: 'inbound', roadIdentity: 'STATION-LINK', name: '车站联系段（旧）', level: 'surface', elevation: 0, from: [520, 320], to: [340, 320] },
            { id: 'v25-IN3', sequence: 3, direction: 'inbound', roadIdentity: 'RIVER-BRIDGE', name: '河滨桥（旧）', level: 'surface', elevation: 0, from: [340, 320], to: [180, 360] },
            { id: 'v25-IN4', sequence: 4, direction: 'inbound', roadIdentity: 'RAMP-E', name: '东向坡道（旧）', level: 'surface', elevation: 0, from: [180, 360], to: [80, 400] }
        ]
    });

    const v2026 = CrossingCore.prepareRoute({
        id: 'route-v2026',
        version: 'v2026-当前',
        name: '滨河慢行线（改线后）',
        effectiveAt: '2026-01-01T00:00:00+08:00',
        segments: [
            { id: 'OB1', sequence: 1, direction: 'outbound', roadIdentity: 'RAMP-E', name: '东向连续坡道', level: 'ramp', elevation: 6, from: [80, 340], to: [220, 290] },
            { id: 'OB2', sequence: 2, direction: 'outbound', roadIdentity: 'RIVER-BRIDGE', name: '河滨桥桥面', level: 'bridge', elevation: 12, from: [220, 290], to: [350, 240] },
            { id: 'OB3', sequence: 3, direction: 'outbound', roadIdentity: 'BR-2026', name: '新建窄桥桥面', level: 'bridge', elevation: 12, narrow: true, from: [350, 240], to: [520, 240] },
            { id: 'OB4', sequence: 4, direction: 'outbound', roadIdentity: 'EAST-APPROACH', name: '东端高架接入口', level: 'elevated', elevation: 10, from: [520, 240], to: [650, 270] },

            { id: 'IN1', sequence: 1, direction: 'inbound', roadIdentity: 'EAST-APPROACH', name: '东端地面接入口', level: 'surface', elevation: 0, from: [650, 380], to: [520, 330] },
            { id: 'IN2', sequence: 2, direction: 'inbound', roadIdentity: 'CON-2026', name: '桥下照明廊道', level: 'surface', elevation: 0, from: [520, 330], to: [350, 310] },
            { id: 'IN3', sequence: 3, direction: 'inbound', roadIdentity: 'RIVER-BRIDGE', name: '河滨桥桥下道路', level: 'surface', elevation: 0, from: [350, 310], to: [220, 330] },
            { id: 'IN4', sequence: 4, direction: 'inbound', roadIdentity: 'RAMP-E', name: '东向地面坡道', level: 'ramp', elevation: 2, from: [220, 330], to: [80, 380] },

            { id: 'TB1', sequence: 1, direction: 'turnback', roadIdentity: 'TB-STATION', name: '车站折返联络段', level: 'connector', elevation: 3, openForPrompt: true, from: [520, 240], to: [600, 290] }
        ]
    });

    const now = CrossingCore.APP_NOW;

    const observations = [
        {
            id: 'OBS-SLP-01',
            type: 'ramp',
            title: '东向连续坡道，雨后局部湿滑',
            observationPoint: [150, 316],
            roadIdentity: 'RAMP-E',
            severity: 'moderate',
            impactRadiusM: 40,
            capturedRouteVersionId: 'route-v2025',
            observedAt: '2026-09-18T09:20:00+08:00',
            source: { kind: '现场巡查', reporter: '李工', observedAt: '2026-09-18T09:20:00+08:00', savedAt: '2026-09-18T10:05:00+08:00' },
            associationStatus: 'confirmed',
            confirmedSegmentId: 'OB1',
            confirmedRouteVersionId: 'route-v2026',
            confirmedAt: '2026-09-19T11:00:00+08:00',
            confirmedBy: '编辑王宁',
            validIntervals: [{ start: '2026-09-20T00:00:00+08:00', end: '2026-10-15T23:59:59+08:00', note: '湿滑巡查期' }],
            followups: []
        },
        {
            id: 'OBS-SURF-02',
            type: 'surface',
            title: '坡道口铺装破损，注意颠簸',
            observationPoint: [190, 306],
            roadIdentity: 'RAMP-E',
            severity: 'minor',
            impactRadiusM: 35,
            capturedRouteVersionId: 'route-v2026',
            observedAt: '2026-09-28T16:10:00+08:00',
            source: { kind: '市民上报', reporter: '匿名骑行者', observedAt: '2026-09-28T16:10:00+08:00', savedAt: '2026-09-28T17:00:00+08:00' },
            associationStatus: 'confirmed',
            confirmedSegmentId: 'OB1',
            confirmedRouteVersionId: 'route-v2026',
            confirmedAt: '2026-09-29T09:30:00+08:00',
            confirmedBy: '编辑王宁',
            validIntervals: [{ start: '2026-10-02T00:00:00+08:00', end: '2026-10-20T23:59:59+08:00', note: '同坡道口施工后复核' }],
            followups: []
        },
        {
            id: 'OBS-BR-03',
            type: 'narrow_bridge',
            title: '新建窄桥净宽不足，两车交会请减速',
            observationPoint: [435, 288],
            roadIdentity: 'BR-2026',
            severity: 'high',
            impactRadiusM: 55,
            capturedRouteVersionId: 'route-v2026',
            observedAt: '2026-09-25T08:00:00+08:00',
            source: { kind: '养护检测', reporter: '市政检测二组', observedAt: '2026-09-25T08:00:00+08:00', savedAt: '2026-09-25T18:30:00+08:00' },
            associationStatus: 'pending',
            confirmedSegmentId: null,
            confirmedRouteVersionId: null,
            confirmedAt: null,
            confirmedBy: null,
            validIntervals: [{ start: '2026-09-26T00:00:00+08:00', end: '2026-11-30T23:59:59+08:00', note: '等待编辑确认桥面还是桥下道路' }],
            followups: []
        },
        {
            id: 'OBS-CON-04',
            type: 'lighting',
            title: '桥下照明廊道多盏灯不亮',
            observationPoint: [430, 321],
            roadIdentity: 'CON-2026',
            severity: 'moderate',
            impactRadiusM: 50,
            capturedRouteVersionId: 'route-v2026',
            observedAt: '2026-09-30T20:15:00+08:00',
            source: { kind: '夜骑回访', reporter: '志愿者陈晨', observedAt: '2026-09-30T20:15:00+08:00', savedAt: '2026-09-30T21:00:00+08:00' },
            associationStatus: 'confirmed',
            confirmedSegmentId: 'IN2',
            confirmedRouteVersionId: 'route-v2026',
            confirmedAt: '2026-09-30T22:00:00+08:00',
            confirmedBy: '编辑王宁',
            validIntervals: [{ start: '2026-10-01T00:00:00+08:00', end: '2026-10-10T23:59:59+08:00', note: '灯具更换排期' }],
            followups: []
        },
        {
            id: 'OBS-LT-05',
            type: 'lighting',
            title: '折返联络段夜间照明缺失',
            observationPoint: [555, 272],
            roadIdentity: 'TB-STATION',
            severity: 'high',
            impactRadiusM: 30,
            capturedRouteVersionId: 'route-v2026',
            observedAt: '2026-09-29T19:40:00+08:00',
            source: { kind: '市民上报', reporter: '夜跑用户', observedAt: '2026-09-29T19:40:00+08:00', savedAt: '2026-09-29T20:00:00+08:00' },
            associationStatus: 'pending',
            confirmedSegmentId: null,
            confirmedRouteVersionId: null,
            confirmedAt: null,
            confirmedBy: null,
            validIntervals: [{ start: '2026-09-30T00:00:00+08:00', end: '2026-10-25T23:59:59+08:00', note: '需人工确认是否折返可通行段' }],
            followups: []
        },
        {
            id: 'OBS-CON-EXPIRED',
            type: 'construction',
            title: '桥下围挡施工（记录已过期）',
            observationPoint: [450, 330],
            roadIdentity: 'CON-2026',
            severity: 'high',
            impactRadiusM: 60,
            capturedRouteVersionId: 'route-v2026',
            observedAt: '2026-08-10T09:00:00+08:00',
            source: { kind: '施工报备', reporter: '施工单位A', observedAt: '2026-08-10T09:00:00+08:00', savedAt: '2026-08-10T12:00:00+08:00' },
            associationStatus: 'confirmed',
            confirmedSegmentId: 'IN2',
            confirmedRouteVersionId: 'route-v2026',
            confirmedAt: '2026-08-10T14:00:00+08:00',
            confirmedBy: '编辑王宁',
            validIntervals: [{ start: '2026-08-12T00:00:00+08:00', end: '2026-09-20T23:59:59+08:00', note: '有效期已过，尚未回访' }],
            followups: []
        },
        {
            id: 'OBS-LIGHT-OLD-DENIED',
            type: 'lighting',
            title: '旧车站段照明故障（回访否定）',
            observationPoint: [470, 252],
            roadIdentity: 'STATION-LINK',
            severity: 'moderate',
            impactRadiusM: 45,
            capturedRouteVersionId: 'route-v2025',
            observedAt: '2026-08-20T20:00:00+08:00',
            source: { kind: '历史巡查', reporter: '李工', observedAt: '2026-08-20T20:00:00+08:00', savedAt: '2026-08-20T21:00:00+08:00' },
            associationStatus: 'denied',
            lifecycleStatus: 'denied',
            confirmedSegmentId: null,
            confirmedRouteVersionId: null,
            confirmedAt: null,
            confirmedBy: null,
            validIntervals: [{ start: '2026-08-21T00:00:00+08:00', end: '2026-10-05T23:59:59+08:00', note: '回访后否定，不应继续提示' }],
            followups: [{ at: '2026-09-15T21:00:00+08:00', result: 'denied', reporter: '志愿者陈晨', note: '现场照明恢复，旧记录关闭。' }]
        }
    ];

    const schemaSql = `-- PostGIS 建议结构（节选）
CREATE TABLE route_versions (
  id uuid PRIMARY KEY,
  version text NOT NULL,
  name text NOT NULL,
  effective_at timestamptz NOT NULL,
  superseded_at timestamptz,
  geom geometry(LineStringM, 3857) NOT NULL
);
CREATE TABLE road_segments (
  id uuid PRIMARY KEY,
  route_version_id uuid REFERENCES route_versions(id),
  road_identity text NOT NULL,
  sequence_no int NOT NULL,
  direction text CHECK (direction IN ('outbound','inbound','turnback')),
  level text NOT NULL,
  elevation_m numeric(5,1) DEFAULT 0,
  start_m numeric(10,2) NOT NULL,
  end_m numeric(10,2) NOT NULL,
  geom geometry(LineString, 3857) NOT NULL
);
CREATE TABLE crossing_observations (
  id uuid PRIMARY KEY,
  point_type text NOT NULL,
  title text NOT NULL,
  observation_point geometry(Point, 3857) NOT NULL,
  impact_radius_m numeric(6,1) NOT NULL,
  impact_area geometry(Polygon, 3857),
  captured_route_version_id uuid REFERENCES route_versions(id),
  road_identity text,
  observed_at timestamptz,
  source jsonb NOT NULL,
  lifecycle_status text DEFAULT 'active'
);
CREATE TABLE segment_association_candidates (
  id uuid PRIMARY KEY,
  observation_id uuid REFERENCES crossing_observations(id),
  candidate_segment_id uuid REFERENCES road_segments(id),
  method text CHECK (method IN ('circular_buffer','road_identity')),
  distance_m numeric(8,2) NOT NULL,
  projection_m numeric(10,2),
  layer text NOT NULL,
  retained boolean DEFAULT true
);
CREATE TABLE confirmed_segment_links (
  observation_id uuid PRIMARY KEY REFERENCES crossing_observations(id),
  segment_id uuid REFERENCES road_segments(id),
  route_version_id uuid REFERENCES route_versions(id),
  confirmed_at timestamptz NOT NULL,
  confirmed_by text NOT NULL
);
CREATE TABLE alert_validity_intervals (
  id uuid PRIMARY KEY,
  observation_id uuid REFERENCES crossing_observations(id),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  note text
);
-- 提示发布只连接 confirmed_segment_links + 当前路线版本 + 有效时间；
-- 过期施工状态应为 stale_info，需要回访，不得推导为现场安全。`;

    root.CrossingData = { routes: { v2025, v2026 }, observations, schemaSql, now };
}(window));
