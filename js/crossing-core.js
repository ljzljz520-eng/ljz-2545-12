/*
 * 慢行路口提示服务：核心领域逻辑（无 DOM 依赖）
 * 坐标为演示平面坐标，单位按“米”处理；生产环境应替换为 PostGIS/GeoJSON。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.CrossingCore = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const APP_NOW = '2026-10-01T08:00:00+08:00';
    const DEFAULT_CONFIG = {
        alertBufferM: 50,       // 圆形提示缓冲：进入该距离才可能作为强几何候选
        analysisBufferM: 100,   // 候选分析缓冲：保留但不自动采用
        cacheTtlMs: 24 * 60 * 60 * 1000
    };

    function sq(v) { return v * v; }
    function distance(a, b) {
        return Math.sqrt(sq(a[0] - b[0]) + sq(a[1] - b[1]));
    }

    function pointSegmentProjection(point, segment) {
        const a = segment.from;
        const b = segment.to;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const lengthSquared = dx * dx + dy * dy;
        let t = lengthSquared === 0 ? 0 : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));
        const projected = [a[0] + t * dx, a[1] + t * dy];
        return {
            segmentId: segment.id,
            roadIdentity: segment.roadIdentity,
            name: segment.name,
            direction: segment.direction,
            level: segment.level,
            elevation: segment.elevation ?? 0,
            routeStartM: segment.routeStartM || 0,
            openForPrompt: segment.openForPrompt !== false,
            t,
            segmentLengthM: segment.lengthM,
            routeM: segment.routeStartM + t * segment.lengthM,
            projectionM: t * segment.lengthM,
            distanceM: distance(point, projected),
            projectedPoint: projected,
            endpoint: t === 0 || t === 1
        };
    }

    function prepareRoute(route) {
        const groups = new Map();
        route.segments.forEach((s) => {
            if (!groups.has(s.direction)) groups.set(s.direction, []);
            groups.get(s.direction).push(s);
        });
        const preparedSegments = [];
        groups.forEach((list) => {
            list.sort((a, b) => a.sequence - b.sequence);
            let start = 0;
            list.forEach((s) => {
                const lengthM = s.lengthM ?? distance(s.from, s.to);
                const copy = Object.assign({}, s, { lengthM, routeStartM: start });
                preparedSegments.push(copy);
                start += lengthM;
            });
        });
        return Object.assign({}, route, { segments: preparedSegments });
    }

    function projectToRoute(point, route) {
        return route.segments
            .map((segment) => pointSegmentProjection(point, segment))
            .sort((a, b) => a.distanceM - b.distanceM);
    }

    function circularBufferCandidates(point, route, config) {
        return projectToRoute(point, route)
            .filter((c) => c.distanceM <= config.analysisBufferM)
            .map((c) => Object.assign({}, c, {
                methods: ['circular_buffer'],
                withinAlertBuffer: c.distanceM <= config.alertBufferM
            }));
    }

    function roadIdentityCandidates(point, route, roadIdentity, config) {
        if (!roadIdentity) return [];
        return projectToRoute(point, route)
            .filter((c) => c.roadIdentity === roadIdentity && c.distanceM <= config.analysisBufferM)
            .map((c) => Object.assign({}, c, {
                methods: ['road_identity'],
                withinAlertBuffer: c.distanceM <= config.alertBufferM
            }));
    }

    function mergeCandidates(groups) {
        const byId = new Map();
        groups.flat().forEach((candidate) => {
            if (!byId.has(candidate.segmentId)) {
                byId.set(candidate.segmentId, Object.assign({}, candidate, { methods: [] }));
            }
            const merged = byId.get(candidate.segmentId);
            candidate.methods.forEach((method) => {
                if (!merged.methods.includes(method)) merged.methods.push(method);
            });
            merged.withinAlertBuffer = merged.withinAlertBuffer || candidate.withinAlertBuffer;
        });
        return Array.from(byId.values()).sort((a, b) => a.distanceM - b.distanceM);
    }

    function matchObservation(record, route, options = {}) {
        const config = Object.assign({}, DEFAULT_CONFIG, options);
        const geometry = circularBufferCandidates(record.observationPoint, route, config);
        const identity = roadIdentityCandidates(record.observationPoint, route, record.roadIdentity, config);
        const candidates = mergeCandidates([geometry, identity]);
        const nearestIdentity = identity[0] || null;
        const nearestGeometry = geometry[0] || null;
        const nearestGeometryHasOtherIdentity = nearestGeometry && nearestIdentity &&
            nearestGeometry.segmentId !== nearestIdentity.segmentId;
        let layer = 'unresolved';
        let associationStatus = 'pending';
        let recommendation = '没有进入分析范围的候选路段，不应发布提示。';

        if (nearestIdentity && nearestIdentity.distanceM <= config.alertBufferM) {
            layer = nearestGeometryHasOtherIdentity
                ? 'identity_with_competing_geometry'
                : 'identity_and_geometry';
            associationStatus = nearestGeometryHasOtherIdentity
                ? 'manual_review'
                : 'ready_for_editor_confirmation';
            recommendation = nearestGeometryHasOtherIdentity
                ? '身份路段在提示缓冲内，但最近投影落在另一段（可能是桥下道路或折返），必须人工判定。'
                : '稳定道路身份与最近圆形缓冲一致；仍须编辑确认后发布。';
        } else if (nearestIdentity && nearestIdentity.distanceM <= config.analysisBufferM) {
            layer = 'identity_only';
            associationStatus = 'manual_review';
            recommendation = '道路身份命中但投影超出提示缓冲，需核对上下层或折返关系。';
        } else if (nearestGeometry && nearestGeometry.distanceM <= config.alertBufferM) {
            layer = 'geometry_only';
            associationStatus = 'manual_review';
            recommendation = '仅圆形缓冲命中；距离可作依据，但不能替代道路身份。';
        } else if (candidates.length) {
            layer = 'weak_geometry';
            associationStatus = 'manual_review';
            recommendation = '仅存在 50–100 米弱候选，保留证据但不得自动提示。';
        }

        return {
            routeVersionId: route.id,
            routeVersion: route.version,
            calculatedAt: options.now || APP_NOW,
            config,
            circularBufferMatches: geometry,
            roadIdentityMatches: identity,
            candidates,
            nearestGeometry,
            nearestIdentity,
            nearestGeometryHasOtherIdentity,
            layer,
            associationStatus,
            recommendation
        };
    }

    function makeImpactExtent(match, segmentId, radiusM) {
        const candidate = match && match.candidates.find((c) => c.segmentId === segmentId);
        if (!candidate) return null;
        const start = Math.max(0, candidate.routeM - radiusM);
        const end = Math.min(candidate.routeStartM + candidate.segmentLengthM, candidate.routeM + radiusM);
        return {
            segmentId,
            routeVersionId: match.routeVersionId,
            startM: Number(start.toFixed(1)),
            endM: Number(end.toFixed(1)),
            centerM: Number(candidate.routeM.toFixed(1)),
            basis: `道路身份=${candidate.methods.includes('road_identity') ? '命中' : '未命中'}；投影距离=${candidate.distanceM.toFixed(1)}米`
        };
    }

    function intervalStatus(record, now = APP_NOW) {
        const at = Date.parse(now);
        const intervals = (record.validIntervals || []).map((i) => ({
            start: Date.parse(i.start),
            end: Date.parse(i.end),
            raw: i
        })).filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end));

        if (record.lifecycleStatus === 'denied' || (record.followups || []).some((f) => f.result === 'denied')) {
            return 'denied';
        }
        if (intervals.some((i) => at >= i.start && at <= i.end)) return 'active';
        if (intervals.every((i) => at > i.end) && intervals.length) return 'expired';
        if (intervals.some((i) => at < i.start)) return 'upcoming';
        return 'unknown';
    }

    function isPublished(record, now = APP_NOW, currentRouteVersionId = 'route-v2026') {
        return Boolean(
            record.confirmedSegmentId &&
            (record.associationStatus === 'confirmed' || record.associationStatus === 'reconfirmed') &&
            intervalStatus(record, now) === 'active' &&
            record.confirmedRouteVersionId === currentRouteVersionId &&
            !record.deletedAt
        );
    }

    function activeAlerts(records, now = APP_NOW, currentRouteVersionId = 'route-v2026') {
        return records.filter((r) => isPublished(r, now, currentRouteVersionId));
    }

    function intervalsOverlap(a, b) {
        return Date.parse(a.start) <= Date.parse(b.end) && Date.parse(b.start) <= Date.parse(a.end);
    }

    function findIntervalOverlaps(records) {
        const warnings = [];
        const visible = records.filter((r) => r.confirmedSegmentId);
        for (let i = 0; i < visible.length; i += 1) {
            for (let j = i + 1; j < visible.length; j += 1) {
                const a = visible[i];
                const b = visible[j];
                if (a.confirmedSegmentId !== b.confirmedSegmentId) continue;
                const shared = (a.validIntervals || []).flatMap((ia) =>
                    (b.validIntervals || [])
                        .filter((ib) => intervalsOverlap(ia, ib))
                        .map((ib) => ({ a: ia, b: ib }))
                );
                if (shared.length) {
                    warnings.push({
                        segmentId: a.confirmedSegmentId,
                        recordIds: [a.id, b.id],
                        message: `${a.id} 与 ${b.id} 在同一确认路段上的有效期交叠，需要合并或说明并存原因。`
                    });
                }
            }
        }
        return warnings;
    }

    function measureOnIdentity(record, route) {
        const candidates = roadIdentityCandidates(record.observationPoint, route, record.roadIdentity, {
            alertBufferM: Infinity,
            analysisBufferM: Infinity
        });
        return candidates[0] || null;
    }

    function recalculateMeasure(record, capturedRoute, targetRoute) {
        const before = measureOnIdentity(record, capturedRoute);
        const after = measureOnIdentity(record, targetRoute);
        const snapshot = {
            observationId: record.id,
            observationPoint: record.observationPoint.slice(),
            capturedRouteVersionId: capturedRoute.id,
            targetRouteVersionId: targetRoute.id,
            roadIdentity: record.roadIdentity,
            oldM: before ? Number(before.routeM.toFixed(1)) : null,
            newM: after ? Number(after.routeM.toFixed(1)) : null,
            targetSegmentId: after ? after.segmentId : null,
            driftedCoordinate: false,
            note: after
                ? '按稳定道路身份重算里程；观察点坐标保持原值。'
                : '目标路线缺少同一道路身份，保留旧里程和坐标，转人工处理。'
        };
        snapshot.deltaM = snapshot.oldM !== null && snapshot.newM !== null
            ? Number((snapshot.newM - snapshot.oldM).toFixed(1))
            : null;
        return snapshot;
    }

    function evaluateCache(cache, now = APP_NOW, options = {}) {
        const config = Object.assign({}, DEFAULT_CONFIG, options);
        const offline = Boolean(options.offline);
        if (!offline) return { state: 'online', useCache: false, stale: false };
        if (!cache || !cache.cachedAt) return { state: 'offline_without_cache', useCache: false, stale: true };
        const ageMs = Date.parse(now) - Date.parse(cache.cachedAt);
        if (ageMs <= config.cacheTtlMs) {
            return { state: 'offline_fresh_cache', useCache: true, stale: false, ageMs };
        }
        return { state: 'offline_expired_cache', useCache: false, stale: true, ageMs };
    }

    function segmentById(route, id) {
        return route.segments.find((s) => s.id === id) || null;
    }

    return {
        APP_NOW,
        DEFAULT_CONFIG,
        distance,
        pointSegmentProjection,
        prepareRoute,
        projectToRoute,
        circularBufferCandidates,
        roadIdentityCandidates,
        matchObservation,
        makeImpactExtent,
        intervalStatus,
        isPublished,
        activeAlerts,
        findIntervalOverlaps,
        measureOnIdentity,
        recalculateMeasure,
        evaluateCache,
        segmentById
    };
}));
