(function () {
    'use strict';

    const core = window.CrossingCore;
    const seed = window.CrossingData;
    const STORAGE_KEY = 'slow-route-crossing-records-v1';
    const CACHE_KEY = 'slow-route-crossing-cache-v1';
    const UI_KEY = 'slow-route-crossing-ui-v1';
    const now = core.APP_NOW;
    const currentRoute = seed.routes.v2026;
    const archiveRoute = seed.routes.v2025;

    const typeMeta = {
        ramp: { label: '坡道', icon: '♿', color: '#2563eb' },
        narrow_bridge: { label: '窄桥', icon: '🌉', color: '#7c3aed' },
        lighting: { label: '照明', icon: '💡', color: '#ca8a04' },
        construction: { label: '施工', icon: '🚧', color: '#ea580c' },
        surface: { label: '铺装', icon: '🧱', color: '#059669' }
    };

    const statusMeta = {
        active: { label: '当前有效', cls: 'active' },
        upcoming: { label: '未到生效', cls: 'upcoming' },
        expired: { label: '信息待更新', cls: 'expired' },
        denied: { label: '回访否定', cls: 'denied' },
        unknown: { label: '时间未知', cls: 'unknown' }
    };

    const layerMeta = {
        identity_and_geometry: '道路身份 + 最近缓冲一致',
        identity_with_competing_geometry: '身份在缓冲内，但最近投影落到另一段',
        identity_only: '仅道路身份命中（需人工）',
        geometry_only: '仅圆形缓冲命中（需人工）',
        weak_geometry: '50–100米弱几何候选',
        unresolved: '无候选'
    };

    const state = {
        records: loadRecords(),
        routeId: currentRoute.id,
        filterType: 'all',
        filterStatus: 'all',
        selectedId: 'OBS-BR-03',
        offline: false,
        cache: loadCache()
    };

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s]));
    }
    function formatDate(value) {
        if (!value) return '—';
        return String(value).replace('T', ' ').replace(/\+.*/, '').slice(0, 16);
    }
    function loadRecords() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : clone(seed.observations);
        } catch (error) {
            return clone(seed.observations);
        }
    }
    function saveRecords() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
    }
    function loadCache() {
        try {
            return JSON.parse(localStorage.getItem(CACHE_KEY)) || freshCachePayload();
        } catch (error) {
            return freshCachePayload();
        }
    }
    function freshCachePayload() {
        return { cachedAt: '2026-10-01T07:30:00+08:00', sourceTime: '2026-10-01T07:30:00+08:00', routeVersionId: currentRoute.id };
    }
    function saveCache() {
        localStorage.setItem(CACHE_KEY, JSON.stringify(state.cache));
    }
    function routeById(id) { return id === archiveRoute.id ? archiveRoute : currentRoute; }
    function recordCapturedRoute(record) {
        return record.capturedRouteVersionId === archiveRoute.id ? archiveRoute : currentRoute;
    }
    function confirmedSegmentFor(record, route = routeById(state.routeId)) {
        const direct = route.segments.find((s) => s.id === record.confirmedSegmentId);
        if (direct) return direct;
        if (!record.roadIdentity) return null;
        const match = core.roadIdentityCandidates(record.observationPoint, route, record.roadIdentity, {
            alertBufferM: Infinity,
            analysisBufferM: Infinity
        })[0];
        return match ? route.segments.find((s) => s.id === match.segmentId) : null;
    }
    function matchFor(record, route = routeById(state.routeId)) {
        return core.matchObservation(record, route, { now });
    }
    function recordStatus(record) { return core.intervalStatus(record, now); }
    function publishedRecords() { return core.activeAlerts(state.records, now, currentRoute.id); }
    function isCurrentPublished(record) { return core.isPublished(record, now, currentRoute.id); }
    function cacheState() { return core.evaluateCache(state.cache, now, { offline: state.offline }); }

    function filteredRecords() {
        return state.records.filter((record) => {
            const status = recordStatus(record);
            const typeOk = state.filterType === 'all' || record.type === state.filterType;
            const statusOk = state.filterStatus === 'all' || status === state.filterStatus;
            return typeOk && statusOk;
        });
    }

    function selectedRecord() {
        return state.records.find((r) => r.id === state.selectedId) || state.records[0];
    }

    function segmentPath(segment) {
        return `M ${segment.from[0]} ${segment.from[1]} L ${segment.to[0]} ${segment.to[1]}`;
    }

    function pointAtM(segment, m) {
        const local = Math.max(0, Math.min(segment.lengthM, m - segment.routeStartM));
        const t = segment.lengthM ? local / segment.lengthM : 0;
        return [
            segment.from[0] + (segment.to[0] - segment.from[0]) * t,
            segment.from[1] + (segment.to[1] - segment.from[1]) * t
        ];
    }

    function routePath(route, direction) {
        const segments = route.segments.filter((s) => s.direction === direction).sort((a, b) => a.sequence - b.sequence);
        if (!segments.length) return '';
        return `M ${segments[0].from[0]} ${segments[0].from[1]} ` + segments.map((s) => `L ${s.to[0]} ${s.to[1]}`).join(' ');
    }

    function extentLine(record) {
        const match = matchFor(record, currentRoute);
        const extent = core.makeImpactExtent(match, record.confirmedSegmentId, record.impactRadiusM);
        const segment = currentRoute.segments.find((s) => s.id === record.confirmedSegmentId);
        if (!extent || !segment) return null;
        const a = pointAtM(segment, extent.startM);
        const b = pointAtM(segment, extent.endM);
        return { a, b, extent, segment };
    }

    function marker(record) {
        const meta = typeMeta[record.type] || { icon: '•', color: '#64748b' };
        const status = recordStatus(record);
        const [x, y] = record.observationPoint;
        const selected = state.selectedId === record.id;
        const label = `${typeMeta[record.type]?.label || '观察点'}：${record.title}，状态${statusMeta[status]?.label || status}`;
        return `
          <g class="map-marker ${selected ? 'selected' : ''} status-${status}" transform="translate(${x} ${y})" role="button" tabindex="0"
             data-record-id="${escapeHtml(record.id)}" aria-label="${escapeHtml(label)}">
            <circle r="${selected ? 15 : 11}" fill="${meta.color}" stroke="white" stroke-width="${selected ? 4 : 2}"></circle>
            <text y="4" text-anchor="middle" font-size="11">${meta.icon}</text>
          </g>`;
    }

    function renderMap() {
        const route = routeById(state.routeId);
        const other = route.id === currentRoute.id ? archiveRoute : currentRoute;
        const selected = selectedRecord();
        const selectedMatch = selected ? matchFor(selected, route) : null;
        const cache = cacheState();
        const cacheBlocked = cache.state === 'offline_expired_cache' || cache.state === 'offline_without_cache';
        const active = cacheBlocked ? [] : publishedRecords();
        const visible = cacheBlocked ? [] : filteredRecords();
        const overlapWarnings = core.findIntervalOverlaps(state.records);

        const extentMarkup = route.id === currentRoute.id ? active.map((record) => {
            const line = extentLine(record);
            if (!line) return '';
            const meta = typeMeta[record.type] || { color: '#64748b' };
            return `
              <line class="impact-line" data-record-id="${escapeHtml(record.id)}" x1="${line.a[0]}" y1="${line.a[1]}" x2="${line.b[0]}" y2="${line.b[1]}"
                    stroke="${meta.color}" data-tooltip="${escapeHtml(record.title)}｜${line.extent.startM}–${line.extent.endM}米"></line>`;
        }).join('') : '';

        const selectedRadius = selected ? `
          <circle class="analysis-buffer" cx="${selected.observationPoint[0]}" cy="${selected.observationPoint[1]}" r="${selected.impactRadiusM}"></circle>
          <circle class="analysis-buffer-wide" cx="${selected.observationPoint[0]}" cy="${selected.observationPoint[1]}" r="100"></circle>` : '';

        const projectionMarkup = selectedMatch ? selectedMatch.candidates.map((candidate) => {
            const seg = route.segments.find((s) => s.id === candidate.segmentId);
            const p = pointAtM(seg, candidate.routeM);
            const isConfirmed = selected.confirmedSegmentId === candidate.segmentId;
            return `
              <g class="candidate-point ${isConfirmed ? 'confirmed-candidate' : ''}">
                <line x1="${selected.observationPoint[0]}" y1="${selected.observationPoint[1]}" x2="${p[0]}" y2="${p[1]}" class="projection-line"></line>
                <circle cx="${p[0]}" cy="${p[1]}" r="${isConfirmed ? 7 : 5}" data-tooltip="${escapeHtml(candidate.name)}｜${candidate.distanceM.toFixed(1)}米｜${candidate.methods.join('+')}"></circle>
              </g>`;
        }).join('') : '';

        const oldGhost = ['outbound', 'inbound'].map((dir) =>
            `<path d="${routePath(other, dir)}" class="ghost-route ghost-${dir}" aria-hidden="true"></path>`).join('');
        const turnback = route.segments.some((s) => s.direction === 'turnback')
            ? `<path d="${routePath(route, 'turnback')}" class="route-line turnback-line"></path>` : '';

        document.getElementById('crossingMap').innerHTML = `
            <svg viewBox="0 0 720 460" role="img" aria-labelledby="mapTitle mapDesc" xmlns="http://www.w3.org/2000/svg">
                <title id="mapTitle">慢行路线与路口受影响路段地图</title>
                <desc id="mapDesc">当前路线与归档路线分层显示。粗线仅代表已经确认且当前有效的受影响里程区间，候选投影用虚线和小圆保留。</desc>
                <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" stroke-width="1"></path>
                    </pattern>
                </defs>
                <rect width="720" height="460" fill="#f8fafc"></rect>
                <rect width="720" height="460" fill="url(#grid)"></rect>
                <text x="28" y="34" class="map-watermark">河道 / 桥下空间</text>
                <path d="M 40 246 C 180 226, 290 214, 430 210 S 640 220, 700 205 L 700 280 C 570 292, 440 286, 300 296 S 140 310, 40 292 Z" fill="#dbeafe" opacity=".75"></path>
                ${oldGhost}
                <path d="${routePath(route, 'outbound')}" class="route-line outbound-line"></path>
                <path d="${routePath(route, 'inbound')}" class="route-line inbound-line"></path>
                ${turnback}
                ${extentMarkup}
                ${selectedRadius}
                ${projectionMarkup}
                ${visible.map(marker).join('')}
                <g class="map-legend" transform="translate(24 398)">
                    <rect width="672" height="42" rx="10" fill="white" opacity=".92"></rect>
                    <line x1="22" y1="21" x2="62" y2="21" class="route-line outbound-line legend-line"></line><text x="72" y="26">去程</text>
                    <line x1="132" y1="21" x2="172" y2="21" class="route-line inbound-line legend-line"></line><text x="182" y="26">回程/桥下</text>
                    <line x1="286" y1="21" x2="326" y2="21" class="route-line turnback-line legend-line"></line><text x="336" y="26">折返</text>
                    <line x1="408" y1="21" x2="448" y2="21" class="impact-line legend-impact"></line><text x="458" y="26">已确认影响段</text>
                    <line x1="570" y1="21" x2="610" y2="21" class="ghost-route legend-line"></line><text x="620" y="26">另一版本</text>
                </g>
            </svg>
            <div id="mapTooltip" class="map-tooltip" hidden></div>
            <p class="map-note">分层：桥面/坡道与桥下道路分离；点到折线的最近点只作为距离证据。当前展示 <strong>${escapeHtml(route.version)}</strong>，另一版本以灰线叠置。${cacheBlocked ? '<strong class="denied-note">离线缓存不可信，观察标记和影响段已隐藏。</strong>' : ''}</p>
            ${overlapWarnings.length ? `<div class="overlap-warning" role="alert">${overlapWarnings.map((w) => escapeHtml(w.message)).join('<br>')}</div>` : ''}
        `;

        bindMapEvents();
    }

    function bindMapEvents() {
        const svg = document.querySelector('#crossingMap svg');
        const tooltip = document.getElementById('mapTooltip');
        svg.querySelectorAll('[data-tooltip]').forEach((el) => {
            el.addEventListener('mousemove', (event) => {
                const rect = svg.getBoundingClientRect();
                tooltip.hidden = false;
                tooltip.textContent = el.getAttribute('data-tooltip');
                tooltip.style.left = `${event.clientX - rect.left + 12}px`;
                tooltip.style.top = `${event.clientY - rect.top + 12}px`;
            });
            el.addEventListener('mouseleave', () => { tooltip.hidden = true; });
        });
        svg.querySelectorAll('.map-marker').forEach((el) => {
            const activate = () => {
                state.selectedId = el.dataset.recordId;
                renderAll();
                document.getElementById('reviewWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
            };
            el.addEventListener('click', activate);
            el.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activate();
                }
            });
        });
    }

    function renderAlerts() {
        const cache = cacheState();
        const blocked = cache.state === 'offline_expired_cache' || cache.state === 'offline_without_cache';
        const alerts = blocked ? [] : publishedRecords();
        document.getElementById('activeAlertList').innerHTML = blocked
            ? '<p class="empty">离线数据不可信：缓存缺失或已过期，已停止展示发布提示。</p>'
            : alerts.map((record) => {
            const line = extentLine(record);
            const meta = typeMeta[record.type] || { icon: '•', label: '提示' };
            return `
              <button class="alert-item" data-record-id="${escapeHtml(record.id)}" type="button"
                       aria-label="受影响段 ${escapeHtml(line ? line.segment.name : '')}，${escapeHtml(record.title)}，里程 ${line ? line.extent.startM + '至' + line.extent.endM + '米' : '待计算'}">
                <span class="alert-icon">${meta.icon}</span>
                <span>
                  <strong>${escapeHtml(record.title)}</strong>
                  <span>${escapeHtml(line ? line.segment.name : '未确认路段')} · ${line ? `${line.extent.startM}–${line.extent.endM} m` : '不发布里程'}</span>
                  <small>来源：${escapeHtml(record.source.kind)} / ${escapeHtml(record.source.reporter)}；观察 ${formatDate(record.observedAt)}</small>
                </span>
              </button>`;
        }).join('') || '<p class="empty">当前没有可发布提示。</p>';

        document.querySelectorAll('#activeAlertList .alert-item').forEach((button) => {
            button.addEventListener('click', () => {
                state.selectedId = button.dataset.recordId;
                state.routeId = currentRoute.id;
                state.filterStatus = 'all';
                state.filterType = 'all';
                document.getElementById('filterStatus').value = 'all';
                document.getElementById('filterType').value = 'all';
                renderAll();
                document.getElementById('reviewWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });

        document.getElementById('activeCount').textContent = alerts.length;
        document.getElementById('pendingCount').textContent = state.records.filter((r) => r.associationStatus === 'pending' && recordStatus(r) !== 'denied').length;
        document.getElementById('staleCount').textContent = state.records.filter((r) => recordStatus(r) === 'expired').length;
    }

    function renderList() {
        const records = filteredRecords();
        const list = document.getElementById('recordList');
        if (cacheState().state === 'offline_expired_cache') {
            list.innerHTML = `<li class="record-card cache-blocked"><strong>离线缓存已过期，已阻止使用旧提示。</strong><p>请恢复联网刷新；过期施工记录不能被解释为现场已恢复安全。</p></li>`;
            return;
        }
        list.innerHTML = records.map((record) => {
            const route = routeById(state.routeId);
            const match = matchFor(record, route);
            const status = recordStatus(record);
            const meta = typeMeta[record.type] || { icon: '•', label: '观察' };
            const confirmedSegment = confirmedSegmentFor(record, route);
            const nearest = match.nearestGeometry;
            const history = (record.measureHistory || []).find((h) => h.targetRouteVersionId === route.id);
            const measure = history ? history.newM : nearest ? nearest.routeM : null;
            const selected = state.selectedId === record.id;
            return `
              <li class="record-card ${selected ? 'selected' : ''} status-${status}" data-record-id="${escapeHtml(record.id)}">
                <button class="record-select" data-record-id="${escapeHtml(record.id)}" aria-current="${selected}">
                  <span class="type-badge">${meta.icon} ${meta.label}</span>
                  <span class="status-pill ${statusMeta[status].cls}">${statusMeta[status].label}</span>
                  <strong>${escapeHtml(record.title)}</strong>
                  <span class="record-meta">最近投影：${nearest ? escapeHtml(nearest.name) + ' / ' + nearest.distanceM.toFixed(1) + ' m / 里程 ' + measure.toFixed(1) + ' m' : '无候选'}</span>
                  <span class="record-meta">确认路段：${confirmedSegment ? escapeHtml(confirmedSegment.name) : '<em>未确认，不用于提示</em>'}</span>
                  <span class="record-meta">来源：${escapeHtml(record.source.kind)} · ${escapeHtml(record.source.reporter)}</span>
                  <span class="record-meta">观察 ${formatDate(record.observedAt)}；后台保存 ${formatDate(record.source.savedAt)}</span>
                  <span class="record-meta">采集版本：${escapeHtml(record.capturedRouteVersionId === archiveRoute.id ? archiveRoute.version : currentRoute.version)}；关联分层：${escapeHtml(layerMeta[match.layer])}</span>
                  ${record.validIntervals.map((i) => `<span class="record-meta interval">有效期：${formatDate(i.start)} 至 ${formatDate(i.end)}${i.note ? '（' + escapeHtml(i.note) + '）' : ''}</span>`).join('')}
                  ${(record.followups || []).map((f) => `<span class="record-meta denied-note">回访 ${formatDate(f.at)}：${escapeHtml(f.note)}</span>`).join('')}
                </button>
              </li>`;
        }).join('') || '<li class="record-card"><p class="empty">当前筛选条件下没有记录。</p></li>';

        list.querySelectorAll('.record-select').forEach((button) => {
            button.addEventListener('click', () => {
                state.selectedId = button.dataset.recordId;
                renderAll();
                document.getElementById('reviewWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function renderReview() {
        const record = selectedRecord();
        const route = routeById(state.routeId);
        if (!record) return;
        const match = matchFor(record, route);
        const status = recordStatus(record);
        const confirmed = confirmedSegmentFor(record, route);
        const captured = recordCapturedRoute(record);
        const recalc = (record.measureHistory || []).find((h) => h.targetRouteVersionId === route.id);
        const candidates = match.candidates.map((candidate) => {
            const chosen = record.confirmedSegmentId === candidate.segmentId;
            return `
              <tr>
                <td>${escapeHtml(candidate.segmentId)}<br><small>${escapeHtml(candidate.name)} / ${candidate.direction} / ${candidate.level} / 标高${candidate.elevation ?? 0}m</small></td>
                <td>${candidate.distanceM.toFixed(1)} m</td>
                <td>${candidate.routeM.toFixed(1)} m</td>
                <td>${candidate.methods.map((m) => m === 'road_identity' ? '道路身份' : '圆形缓冲').join('、')}</td>
                <td>${candidate.endpoint ? '端点投影，需警惕' : '线段内投影'}</td>
                <td>
                  ${route.id === currentRoute.id && !chosen ? `<button class="x-btn small confirm-candidate" data-segment-id="${escapeHtml(candidate.segmentId)}">确认真实路段</button>` : ''}
                  ${chosen ? '<strong class="chosen">已选择</strong>' : ''}
                </td>
              </tr>`;
        }).join('');

        document.getElementById('reviewWorkspace').innerHTML = `
            <div class="section-heading">
              <div>
                <h2>候选保留与人工纠错</h2>
                <p>自动关联只给建议；编辑确认真实路段后才生成发布提示。</p>
              </div>
              <span class="status-pill ${statusMeta[status].cls}">${statusMeta[status].label}</span>
            </div>
            <div class="review-grid">
              <article class="review-card">
                <h3>${escapeHtml(record.id)}｜${typeMeta[record.type]?.label}｜${escapeHtml(record.title)}</h3>
                <dl class="detail-list">
                  <dt>观察点坐标</dt><dd>[${record.observationPoint.join(', ')}]（改线重算时不变）</dd>
                  <dt>声明道路身份</dt><dd><code>${escapeHtml(record.roadIdentity)}</code></dd>
                  <dt>影响范围</dt><dd>圆形分析半径 100 m；提示缓冲 ${record.impactRadiusM} m，确认后裁剪到真实路段里程。</dd>
                  <dt>有效区间</dt><dd>${record.validIntervals.map((i) => `${formatDate(i.start)} 至 ${formatDate(i.end)}`).join('<br>')}</dd>
                  <dt>采集路线版本</dt><dd>${escapeHtml(captured.version)}</dd>
                  <dt>当前候选分层</dt><dd>${escapeHtml(layerMeta[match.layer])}</dd>
                  <dt>里程依据</dt><dd>${recalc ? `旧 ${recalc.oldM?.toFixed(1)} m → 新 ${recalc.newM?.toFixed(1)} m；坐标未漂移（Δ ${recalc.deltaM?.toFixed(1)} m）` : '尚未执行版本化重算'}</dd>
                  <dt>已确认链接</dt><dd>${confirmed ? `${escapeHtml(confirmed.name)}（${formatDate(record.confirmedAt)}，${escapeHtml(record.confirmedBy || '')}）` : '<strong>无；不会发布</strong>'}</dd>
                </dl>
                <div class="review-actions">
                  ${record.associationStatus !== 'denied' ? `<button class="x-btn danger deny-record">回访否定此记录</button>` : '<span class="denied-banner">已被回访否定，禁止扩散提示。</span>'}
                  <button class="x-btn ghost recalc-record">按路线版本重算此点里程</button>
                </div>
                ${status === 'expired' ? '<p class="safety-note" role="alert">施工或提示有效期已过，只代表信息待更新；没有新回访证据前，不能说现场已恢复安全。</p>' : ''}
              </article>
              <article class="review-card candidates-card">
                <h3>候选路段与距离依据</h3>
                <p class="recommendation">${escapeHtml(match.recommendation)}</p>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>候选路段</th><th>距离</th><th>路线里程</th><th>关联方法</th><th>投影形态</th><th>人工操作</th></tr></thead>
                    <tbody>${candidates || '<tr><td colspan="6">无候选</td></tr>'}</tbody>
                  </table>
                </div>
              </article>
            </div>`;

        document.querySelectorAll('.confirm-candidate').forEach((button) => {
            button.addEventListener('click', () => confirmCandidate(record, button.dataset.segmentId));
        });
        const deny = document.querySelector('.deny-record');
        if (deny) deny.addEventListener('click', () => denyRecord(record));
        document.querySelector('.recalc-record').addEventListener('click', () => {
            recalcOne(record);
            announce(`已按稳定道路身份重算 ${record.id}，观察点坐标保持不变。`);
        });
    }

    function confirmCandidate(record, segmentId) {
        const match = matchFor(record, currentRoute);
        const candidate = match.candidates.find((c) => c.segmentId === segmentId);
        if (!candidate) return;
        record.associationStatus = 'confirmed';
        record.confirmedSegmentId = segmentId;
        record.confirmedRouteVersionId = currentRoute.id;
        record.confirmedAt = now;
        record.confirmedBy = '当前编辑员';
        record.impactExtent = core.makeImpactExtent(match, segmentId, record.impactRadiusM);
        saveRecords();
        announce(`已确认 ${record.id} 的真实路段为 ${candidate.name}，提示仅发布到该里程区间。`);
        renderAll();
    }

    function denyRecord(record) {
        record.associationStatus = 'denied';
        record.lifecycleStatus = 'denied';
        record.confirmedSegmentId = null;
        record.confirmedRouteVersionId = null;
        record.followups = record.followups || [];
        record.followups.push({ at: now, result: 'denied', reporter: '当前编辑员', note: '人工回访否定该观察，旧提示立即停止。' });
        saveRecords();
        announce(`${record.id} 已被回访否定，不会继续提示。`);
        renderAll();
    }

    function recalcOne(record) {
        const target = routeById(state.routeId);
        const captured = recordCapturedRoute(record);
        const snapshot = core.recalculateMeasure(record, captured, target);
        record.measureHistory = (record.measureHistory || []).filter((h) => h.targetRouteVersionId !== target.id);
        record.measureHistory.push(snapshot);
        saveRecords();
        renderAll();
    }

    function renderAdmin() {
        const form = document.getElementById('observationForm');
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const x = Number(document.getElementById('pointX').value);
            const y = Number(document.getElementById('pointY').value);
            const observedAt = document.getElementById('observedAt').value;
            const start = document.getElementById('validStart').value;
            const end = document.getElementById('validEnd').value;
            if (!Number.isFinite(x) || !Number.isFinite(y) || !observedAt || !start || !end || new Date(start) > new Date(end)) {
                announce('请检查坐标、观察时间和有效区间。');
                return;
            }
            const id = `OBS-NEW-${String(state.records.length + 1).padStart(2, '0')}`;
            const record = {
                id,
                type: document.getElementById('recordType').value,
                title: document.getElementById('recordTitle').value.trim() || '新建慢行路口观察',
                observationPoint: [x, y],
                roadIdentity: document.getElementById('roadIdentity').value.trim(),
                severity: 'moderate',
                impactRadiusM: Number(document.getElementById('impactRadius').value) || 50,
                capturedRouteVersionId: currentRoute.id,
                observedAt: new Date(observedAt).toISOString(),
                source: {
                    kind: document.getElementById('sourceKind').value.trim() || '人工录入',
                    reporter: document.getElementById('reporter').value.trim() || '后台编辑',
                    observedAt: new Date(observedAt).toISOString(),
                    savedAt: now
                },
                associationStatus: 'pending',
                confirmedSegmentId: null,
                confirmedRouteVersionId: null,
                confirmedAt: null,
                confirmedBy: null,
                validIntervals: [{ start: new Date(start).toISOString(), end: new Date(end).toISOString(), note: '后台新录入，待人工确认' }],
                followups: []
            };
            state.records.push(record);
            state.selectedId = id;
            state.routeId = currentRoute.id;
            saveRecords();
            form.reset();
            announce('观察点、影响半径、有效区间和采集路线版本已保存；系统仅保留候选，尚未发布。');
            renderAll();
        });

        document.getElementById('recalcAll').addEventListener('click', () => {
            state.records.forEach((record) => {
                const snapshot = core.recalculateMeasure(record, recordCapturedRoute(record), currentRoute);
                record.measureHistory = (record.measureHistory || []).filter((h) => h.targetRouteVersionId !== currentRoute.id);
                record.measureHistory.push(snapshot);
            });
            saveRecords();
            announce('已按道路身份批量重算里程；所有原始观察坐标保持不变，无法匹配身份的记录转人工。');
            renderAll();
        });
    }

    function renderDataPanel() {
        document.getElementById('schemaSql').textContent = seed.schemaSql;
        document.getElementById('routeVersionLabel').textContent = routeById(state.routeId).version;
        const c = cacheState();
        const labels = {
            online: '在线：以后台/空间数据库结果为准',
            offline_fresh_cache: '离线：缓存未过期，可只读展示并标注时点',
            offline_expired_cache: '离线：缓存已过期，已阻止旧提示',
            offline_without_cache: '离线：无缓存，不展示提示'
        };
        const banner = document.getElementById('cacheBanner');
        banner.className = `cache-banner ${c.state}`;
        banner.innerHTML = `
          <strong>${labels[c.state] || c.state}</strong>
          <span>缓存生成：${formatDate(state.cache.cachedAt)}；数据时点：${formatDate(state.cache.sourceTime)}；判断时点：${formatDate(now)}。TTL 24 小时。</span>`;

        document.getElementById('sourceLedger').innerHTML = state.records.slice(0, 5).map((r) =>
            `<li><code>${escapeHtml(r.id)}</code>：${escapeHtml(r.source.kind)} / ${escapeHtml(r.source.reporter)}，观察 ${formatDate(r.observedAt)}，保存 ${formatDate(r.source.savedAt)}</li>`
        ).join('');
    }

    function bindControls() {
        document.getElementById('routeVersion').addEventListener('change', (event) => {
            state.routeId = event.target.value;
            renderAll();
        });
        document.getElementById('filterType').addEventListener('change', (event) => {
            state.filterType = event.target.value;
            renderList();
            renderMap();
        });
        document.getElementById('filterStatus').addEventListener('change', (event) => {
            state.filterStatus = event.target.value;
            renderList();
            renderMap();
        });
        document.getElementById('offlineToggle').addEventListener('change', (event) => {
            state.offline = event.target.checked;
            renderAll();
        });
        document.getElementById('cacheFresh').addEventListener('click', () => {
            state.cache = { cachedAt: '2026-10-01T07:30:00+08:00', sourceTime: '2026-10-01T07:30:00+08:00', routeVersionId: currentRoute.id };
            saveCache();
            announce('已写入未过期离线缓存。');
            renderAll();
        });
        document.getElementById('cacheExpired').addEventListener('click', () => {
            state.cache = { cachedAt: '2026-09-29T07:30:00+08:00', sourceTime: '2026-09-29T07:30:00+08:00', routeVersionId: currentRoute.id };
            state.offline = true;
            document.getElementById('offlineToggle').checked = true;
            saveCache();
            announce('已模拟超过 24 小时的离线缓存，旧提示被阻止。');
            renderAll();
        });
        document.getElementById('cacheClear').addEventListener('click', () => {
            localStorage.removeItem(CACHE_KEY);
            state.cache = null;
            state.offline = true;
            document.getElementById('offlineToggle').checked = true;
            announce('已清除缓存。');
            renderAll();
        });
        document.getElementById('resetDemo').addEventListener('click', () => {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(CACHE_KEY);
            location.reload();
        });
    }

    function announce(message) {
        const live = document.getElementById('liveStatus');
        live.textContent = message;
    }

    function renderAll() {
        document.getElementById('routeVersion').value = state.routeId;
        renderDataPanel();
        renderMap();
        renderAlerts();
        renderList();
        renderReview();
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindControls();
        renderAdmin();
        renderAll();
        announce('路口提示服务已载入：只有编辑确认且当前有效的真实路段会发布。');
    });
}());
