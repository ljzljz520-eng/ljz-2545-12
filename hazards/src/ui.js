// 前端交互：SVG 地图 + 可读列表 + 模拟后台。
// 纯渲染部分复用 src/view.js；本文件只做 DOM 绑定与用户操作。

import { AppStore, confirmCandidate, manualConfirmSegment, rejectAllCandidates, addRevisit, refreshCandidates, STATE_LABELS, lifecycleState } from './advisory.js';
import { buildViewModel, TONE_LABEL } from './view.js';
import { HAZARD_TYPES, NOW, createObservation } from './model.js';
import { OfflineCache } from './cache.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (iso) => (iso ? iso.replace('T', ' ').replace(/\+.*/, '').slice(0, 16) : '长期');

export function initHazardsPage() {
  const root = document.getElementById('hzApp');
  if (!root) return;
  const cache = new OfflineCache({ namespace: 'manxing.hazards' });

  let store = AppStore.seed(NOW);
  let ui = {
    routeFilter: 'all',
    travelDirection: 'forward',
    selectedAnchor: null,
    simulatedNow: NOW,
  };

  // 尝试读取已保存的后台编辑
  const saved = cache.load('edit-state');
  if (saved.status === 'fresh' || saved.status === 'expired') {
    try { restoreState(store, saved.data); } catch { /* 数据损坏则回退种子 */ }
  }
  store.now = ui.simulatedNow;
  populateVersionControls(store);

  const els = {
    banner: document.getElementById('hzCacheBanner'),
    map: document.getElementById('hzMap'),
    list: document.getElementById('hzList'),
    live: document.getElementById('hzLive'),
    admin: document.getElementById('hzAdminList'),
    filter: document.getElementById('hzRouteFilter'),
    version: document.getElementById('hzVersionSelect'),
    direction: document.getElementById('hzDirection'),
    timeBtn: document.getElementById('hzTimeTravel'),
    saveOffline: document.getElementById('hzSaveOffline'),
    loadOffline: document.getElementById('hzLoadOffline'),
    expireCache: document.getElementById('hzExpireCache'),
    reset: document.getElementById('hzReset'),
    form: document.getElementById('hzAddForm'),
    snapTime: document.getElementById('hzSnapTime'),
  };

  // ---------- 渲染 ----------
  function render() {
    const activeRouteIds = new Set();
    store.routes.forEach((rv) => {
      if (store.activeVersions[rv.routeId] === rv.version) activeRouteIds.add(rv.routeId);
    });
    const activeMap = new Map();
    store.routes.forEach((rv) => { if (activeRouteIds.has(rv.routeId) && store.activeVersions[rv.routeId] === rv.version) activeMap.set(`${rv.routeId}@${rv.version}`, rv); });

    const advisories = store.advisories();
    const vm = buildViewModel(advisories, activeMap, { travelDirection: ui.travelDirection });

    renderMap(els.map, vm, store, ui);
    renderList(els.list, vm, ui);
    renderAdmin(els.admin, store, { onConfirm, onManual, onReject, onRevisit });
    wireAnchors();
    persist();
    return { advisories, vm };
  }

  function onConfirm(obsId, routeId, version, segKey) {
    const obs = store.observations.find((o) => o.id === obsId);
    const cand = obs.candidates.find((c) => c.routeId === routeId && c.version === version && c.segmentKey === segKey);
    confirmCandidate(obs, cand, { at: store.now });
    announce(`已确认 ${obs.id} 的真实路段：${segKey}`);
    render();
  }
  function onManual(obsId, routeId, version, segKey) {
    const obs = store.observations.find((o) => o.id === obsId);
    const rv = store.routes.get(`${routeId}@${version}`);
    const seg = rv.segments.find((s) => `${s.roadCode}|${s.level}|${s.segmentId}` === segKey);
    manualConfirmSegment(obs, rv, seg, { at: store.now });
    announce(`已人工纠错 ${obs.id} → ${segKey}（自动候选保留可查）`);
    render();
  }
  function onReject(obsId) {
    const obs = store.observations.find((o) => o.id === obsId);
    rejectAllCandidates(obs, { at: store.now });
    announce(`已拒绝 ${obs.id} 的全部自动候选，在重新确认前不会提示`);
    render();
  }
  function onRevisit(obsId, conclusion) {
    const obs = store.observations.find((o) => o.id === obsId);
    addRevisit(obs, { at: store.now, conclusion });
    const msg = { present: '回访确认问题仍存在', absent: '回访否定：立即停止提示，旧记录保留', cleared: '回访确认现场已恢复安全' }[conclusion];
    announce(`${obs.id}：${msg}`);
    render();
  }

  // ---------- 工具条 ----------
  els.filter.addEventListener('change', () => { ui.routeFilter = els.filter.value; render(); });
  if (els.version) {
    els.version.addEventListener('change', () => {
      store.setActiveVersion('R-binhe', Number(els.version.value));
      announce(`滨河路线已切换到 v${els.version.value}：确认段里程按该版本重算；身份消失的记录不会沿用旧坐标`);
      render();
    });
  }
  els.direction.addEventListener('change', () => { ui.travelDirection = els.direction.value; announce(`行进方向：${ui.travelDirection === 'reverse' ? '返程（里程反向换算）' : '去程'}`); render(); });
  els.timeBtn.addEventListener('click', () => {
    if (ui.simulatedNow === NOW) {
      ui.simulatedNow = '2026-12-20T09:00:00+08:00';
      els.timeBtn.textContent = '当前演示时点：2026-12-20（回到 10-01）';
    } else {
      ui.simulatedNow = NOW;
      els.timeBtn.textContent = '当前演示时点：2026-10-01（快进到 12-20）';
    }
    store.now = ui.simulatedNow;
  populateVersionControls(store);
    announce('已切换演示时点，请留意施工记录与有效期状态变化');
    render();
  });
  els.reset.addEventListener('click', () => {
    cache.clear('edit-state');
    location.reload();
  });

  // ---------- 离线缓存 ----------
  els.saveOffline.addEventListener('click', () => {
    const { advisories, vm } = render();
    cache.save('offline-snapshot', { savedAt: store.now, advisories: ids(advisories), listCount: vm.listItems.length }, { ttlMs: CACHE_TTL_MS, savedAt: Date.now() });
    showBanner('fresh', `已保存离线快照（${new Date().toLocaleString('zh-CN')}），24 小时内有效。数据来源时点：${fmtDate(store.now)}。`);
  });
  els.loadOffline.addEventListener('click', () => {
    const r = cache.load('offline-snapshot');
    if (r.status === 'missing') showBanner('expired', '本地没有离线快照。');
    else if (r.status === 'fresh') showBanner('fresh', `离线快照（来源时点 ${fmtDate(r.data.savedAt)}，本地保存于 ${new Date(r.savedAt).toLocaleString('zh-CN')}）：${r.data.listCount} 条提示。`);
    else showBanner('expired', `⚠ 离线缓存已过期：来源时点 ${fmtDate(r.data?.savedAt)}，仅供参考，不能当作最新现场状况。`);
  });
  els.expireCache.addEventListener('click', () => {
    const r = cache.load('offline-snapshot');
    if (r.status === 'missing') { showBanner('expired', '请先保存离线快照。'); return; }
    cache.save('offline-snapshot', r.data, { ttlMs: CACHE_TTL_MS, savedAt: Date.now() - (CACHE_TTL_MS + 60_000) });
    const x = cache.load('offline-snapshot');
    showBanner('expired', `⚠ 已模拟缓存过期（保存于 ${new Date(x.savedAt).toLocaleString('zh-CN')}）。过期快照不会伪装成新数据。`);
  });
  window.addEventListener('online', () => showBanner('fresh', '网络已恢复：可重新同步提示数据。'));
  window.addEventListener('offline', () => showBanner('offline', '当前离线：展示本地快照，请注意缓存时点与过期标记。'));

  // ---------- 新增观察 ----------
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(els.form);
    const id = `ON${String(store.observations.length + 1).padStart(2, '0')}`;
    const obs = createObservation(id, {
      type: fd.get('type'),
      point: [Number(fd.get('x')), Number(fd.get('y'))],
      level: Number(fd.get('level')),
      radius: Number(fd.get('radius')),
      impactMeters: Number(fd.get('impact')),
      source: fd.get('source') || '现场新增',
      observedAt: store.now,
      startAt: fd.get('startAt') || store.now,
      endAt: fd.get('endAt') || null,
      construction: fd.get('construction') === 'on',
      note: fd.get('note') || '',
    });
    store.observations.push(obs);
    refreshCandidates(store.observations, store.routes);
    announce(`已登记观察点 ${id}，自动关联候选待编辑确认，确认前不会对用户提示`);
    els.form.reset();
    render();
  });

  function persist() {
    cache.save('edit-state', serializeState(store), { ttlMs: 7 * 24 * 3600 * 1000 });
  }
  function showBanner(kind, text) {
    els.banner.className = `hz-cache-banner show ${kind}`;
    els.banner.textContent = text;
  }
  function announce(text) { els.live.textContent = text; }

  render();
  showBanner('fresh', `数据来源时点：${fmtDate(store.now)}。提示仅标注到已确认的受影响路段，不会扩散到整条路线。`);
}

function ids(advisories) { return advisories.map((a) => `${a.observationId}:${a.state}`); }

// ===========================================================================
// 地图渲染
// ===========================================================================
function renderMap(svg, vm, store, ui) {
  const M = 30; // 边距
  const levelDy = (level) => level * -12; // 仅图示偏移：高架画在上方
  let defs = `<defs>
    <marker id="hzArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#a0aec0"/></marker>
  </defs>`;
  let body = '';
  const routeColors = new Set();

  vm.mapLayers.forEach((layer) => {
    if (ui.routeFilter !== 'all' && ui.routeFilter !== layer.routeId) return;
    const dy = levelDy(layer.level);
    const d = (coords) => coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p[0] + M).toFixed(1)},${(p[1] + M + dy).toFixed(1)}`).join(' ');
    const full = layer.segments.flatMap((s, i) => (i === 0 ? s.coords : s.coords.slice(1)));
    body += `<g class="hz-route" data-route="${esc(layer.routeId)}" role="group" aria-label="${esc(layer.name)}（版本${layer.version}，${layer.direction === 'both' ? '双向' : layer.direction === 'reverse' ? '返程' : '去程'}，${layer.affectedCount}/${layer.totalCount} 段有提示）">`;
    body += `<path class="hz-route-outline" d="${d(full)}"/>`;
    body += `<path class="hz-route-base" d="${d(full)}"/>`;
    layer.segments.forEach((seg) => {
      const label = seg.anchors.length ? `${seg.anchors.length} 条提示的受影响段` : '暂无已确认提示的路段';
      const toneCls = seg.affected ? seg.tone : '';
      body += `<path class="hz-seg ${toneCls}" data-segment="${esc(seg.segmentKey)}" data-anchors="${esc(seg.anchors.join(' '))}"
        d="${d(seg.coords)}" tabindex="${seg.affected ? 0 : -1}"
        role="${seg.affected ? 'button' : 'presentation'}"
        aria-label="${esc(layer.name)} 段 ${esc(seg.segmentId)}（层${seg.level}）：${label}"/>`;
    });
    // 路线名与层标签
    const first = full[0];
    body += `<text class="hz-map-label" x="${first[0] + M - 4}" y="${first[1] + M + dy - 12}">${esc(layer.name)} v${layer.version}${layer.level !== 0 ? `（层${layer.level}，图示上移）` : ''}</text>`;
    if (layer.direction !== 'forward') {
      const last = full[full.length - 1];
      body += `<text class="hz-level-tag" x="${last[0] + M - 30}" y="${last[1] + M + dy + 18}">${layer.direction === 'both' ? '双向' : '返程'}◄</text>`;
    }
    body += '</g>';
  });

  // 已确认观察点标记 + 投影依据
  vm.listItems.forEach((item) => {
    if (ui.routeFilter !== 'all' && item.location && item.location.routeId !== ui.routeFilter) return;
    const obs = store.observations.find((o) => o.id === item.observationId);
    const dy = levelDy(obs.level);
    const cx = obs.point[0] + M;
    const cy = obs.point[1] + M + dy;
    if (item.location) {
      const tone = item.tone;
      const fill = { danger: '#e53e3e', warn: '#dd6b20', info: '#3182ce', muted: '#a0aec0' }[tone] || '#a0aec0';
      body += `<g data-anchor-marker="${esc(item.anchor)}" role="presentation">
        <circle class="hz-marker" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${fill}"/>
        <text x="${cx.toFixed(1)}" y="${cy.toFixed(1) + 3.5}" text-anchor="middle" font-size="9">${HAZARD_TYPES[item.type] ? '' : ''}${item.typeIcon}</text>
      </g>`;
      // 人工纠错的投影依据线（观察点 → 实际采用的投影点）
      const assoc = obs.association;
      if (assoc && assoc.method === 'manual' && assoc.distance > 0.5) {
        const pdy = levelDy(assoc.level);
        body += `<line class="hz-projection" x1="${cx}" y1="${cy}" x2="${(assoc.projectedPoint[0] + M).toFixed(1)}" y2="${(assoc.projectedPoint[1] + M + pdy).toFixed(1)}"/>`;
        body += `<circle cx="${(assoc.projectedPoint[0] + M).toFixed(1)}" cy="${(assoc.projectedPoint[1] + M + pdy).toFixed(1)}" r="3" fill="none" stroke="#718096"/>`;
      }
    } else if (item.lastGood) {
      // version-stale：空心警示点，不接到任何新段
      body += `<g role="presentation"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="#fff" stroke="#dd6b20" stroke-width="2.5"/>
        <text x="${cx.toFixed(1)}" y="${cy.toFixed(1) + 3.5}" text-anchor="middle" font-size="9">?</text></g>`;
    }
  });

  // 未确认（pending）观察点：灰色空心，明确“尚不用于提示”
  store.observations.forEach((obs) => {
    if (obs.association) return;
    if (ui.routeFilter !== 'all') {
      const onRoute = obs.candidates.some((c) => c.routeId === ui.routeFilter);
      if (!onRoute) return;
    }
    const dy = levelDy(obs.level);
    body += `<g role="presentation"><circle cx="${obs.point[0] + M}" cy="${obs.point[1] + M + dy}" r="5" fill="#fff" stroke="#a0aec0" stroke-dasharray="2 2" stroke-width="1.5"/>
      <text class="hz-level-tag" x="${obs.point[0] + M + 8}" y="${obs.point[1] + M + dy + 3}">${esc(obs.id)} 待确认</text></g>`;
  });

  svg.innerHTML = defs + body;
  svg.setAttribute('viewBox', '0 70 460 470');
}

// ===========================================================================
// 可读列表
// ===========================================================================
function renderList(ul, vm, ui) {
  const items = vm.listItems.filter((it) => ui.routeFilter === 'all' || it.routeId === ui.routeFilter);
  if (!items.length) {
    ul.innerHTML = '<li class="hz-item muted"><p>当前条件下没有已确认、可定位的提示。未确认候选见下方后台。</p></li>';
    return;
  }
  ul.innerHTML = items.map((it) => {
    const meta = STATE_LABELS[it.state] ?? { text: it.state, tone: 'muted' };
    const stale = it.kind === 'version-stale';
    const loc = it.location
      ? `<dd class="hz-loc">${esc(it.location.routeName)} v${it.location.routeVersion} · 段 ${esc(it.location.segmentId)} ·
           ${it.location.direction === 'reverse' ? '返程' : '去程'}里程 ${it.location.fromMeter}–${it.location.toMeter} m
           ${it.location.migratedFromVersion ? `<span class="migrated">（自 v${it.location.migratedFromVersion} 改线重算，旧坐标未沿用）</span>` : ''}
         </dd>`
      : `<dd class="hz-loc">${stale ? `🚧 ${esc(it.text)}；最后有效版本 v${it.lastGood?.version}、里程 ${it.lastGood?.mileage}m（旧坐标冻结，待人工重认）` : esc(it.text || '暂不可定位')}</dd>`;
    return `<li class="hz-item ${it.tone}" id="hzli-${esc(it.anchor)}" data-anchor="${esc(it.anchor)}" tabindex="-1">
      <h4><span aria-hidden="true">${it.typeIcon}</span>${esc(it.typeLabel)}
        <span class="hz-obsid">${esc(it.observationId)}</span>
        <span class="hz-badge ${it.tone}">${esc(TONE_LABEL[it.tone] || '')} · ${esc(it.stateText)}</span>
      </h4>
      <dl>
        <dt>位置</dt>${loc}
        <dt>来源</dt><dd>${esc(it.source)}</dd>
        <dt>观察时点</dt><dd><time>${fmtDate(it.observedAt)}</time></dd>
        <dt>有效区间</dt><dd>${fmtDate(it.startAt)} ～ ${it.endAt ? fmtDate(it.endAt) : '长期有效'}${it.construction ? '（施工记录）' : ''}</dd>
      </dl>
      <p class="hz-note">${esc(it.note)}</p>
    </li>`;
  }).join('');
}

// 地图 ↔ 列表联动（屏幕阅读器可定位同一段）
function wireAnchors() {
  const live = document.getElementById('hzLive');
  document.querySelectorAll('.hz-seg[data-anchors]').forEach((seg) => {
    const anchors = seg.getAttribute('data-anchors').split(' ').filter(Boolean);
    if (!anchors.length) return;
    const activate = () => {
      document.querySelectorAll('.hz-item.hz-selected').forEach((n) => n.classList.remove('hz-selected'));
      seg.classList.add('active-focus');
      const first = anchors[0];
      const li = document.getElementById(`hzli-${first}`); // id 原样匹配，不做 CSS 转义
      if (li) { li.classList.add('hz-selected'); li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); li.focus({ preventScroll: true }); }
      live.textContent = `地图定位：该段含 ${anchors.length} 条提示，已在列表中高亮对应记录。`;
    };
    seg.addEventListener('click', activate);
    seg.addEventListener('focus', activate);
    seg.addEventListener('blur', () => seg.classList.remove('active-focus'));
  });
  document.querySelectorAll('.hz-item[data-anchor]').forEach((li) => {
    li.addEventListener('focus', () => {
      const anchor = li.getAttribute('data-anchor');
      document.querySelectorAll('.hz-seg').forEach((s) => s.classList.toggle('active-focus', (s.getAttribute('data-anchors') || '').split(' ').includes(anchor)));
    });
    li.addEventListener('click', () => {
      const anchor = li.getAttribute('data-anchor');
      const seg = [...document.querySelectorAll('.hz-seg[data-anchors]')]
        .find((x) => (x.getAttribute('data-anchors') || '').split(' ').includes(anchor));
      if (seg) seg.focus();
    });
  });
}

// ===========================================================================
// 后台：候选、距离依据、纠错、回访
// ===========================================================================
function renderAdmin(tbody, store, actions) {
  tbody.innerHTML = store.observations.map((obs) => {
    const stateLbl = STATE_LABELS[lifecycleState(obs, store.now)]?.text ?? '';
    const assoc = obs.association;
    const cands = obs.candidates;
    const chosenKey = assoc ? `${assoc.routeId}@${assoc.version}|${assoc.roadCode}|${assoc.level}|${assoc.segmentId}` : null;
    const candRows = cands.length ? cands.map((c, i) => {
      const key = `${c.routeId}@${c.version}|${c.segmentKey}`;
      const chosen = chosenKey === key;
      const tierLabel = c.segmentIdMatch ? 'identity（身份命中）' : 'buffer（圆形缓冲）';
      return `<tr class="${chosen ? 'chosen' : ''}">
        <td>${i + 1}</td>
        <td>${esc(c.routeName)} v${c.version}</td>
        <td>${esc(c.segmentId)} <span class="hz-meta-line">层${c.level}${c.sameLevel ? '·同层' : '·异层'}</span></td>
        <td><span class="hz-pill ${c.segmentIdMatch ? 'identity' : 'buffer'}">${tierLabel}</span></td>
        <td>${c.distance.toFixed(1)} m ${c.withinRadius ? '（缓冲内）' : '（缓冲外）'}</td>
        <td>${c.mileage.toFixed(1)} m</td>
        <td>(${c.projectedPoint[0].toFixed(0)},${c.projectedPoint[1].toFixed(0)})</td>
        <td><button class="hz-btn hz-ok" data-act="confirm" data-route="${esc(c.routeId)}" data-version="${c.version}" data-seg="${esc(c.segmentKey)}" ${chosen ? 'disabled' : ''}>${chosen ? '已采用' : '确认此段'}</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="8">无候选（观察点不在任何缓冲内）</td></tr>';

    // 手工指定（纠错）：任意路线版本×任意段
    const segOptions = [...store.routes.values()].flatMap((rv) => rv.segments.map((s) => {
      const key = `${rv.routeId}@${rv.version}|${s.roadCode}|${s.level}|${s.segmentId}`;
      return `<option value="${esc(key)}">${esc(rv.name)} v${rv.version} / ${esc(s.segmentId)}（层${s.level}）</option>`;
    })).join('');

    const revisits = obs.revisits.map((r) =>
      `<li class="hz-meta-line">${fmtDate(r.at)} ${esc(r.by)}：${({ present: '仍存在', absent: '否定（停止提示）', cleared: '已恢复' })[r.conclusion]} ${esc(r.note || '')}</li>`).join('');

    return `<div class="hz-obs" data-obs="${esc(obs.id)}">
      <div class="hz-obs-head" tabindex="0" role="button" aria-expanded="false">
        <strong>${HAZARD_TYPES[obs.type]?.icon ?? ''} ${esc(HAZARD_TYPES[obs.type]?.label ?? obs.type)} ${esc(obs.id)}</strong>
        <span class="hz-badge ${assoc ? 'info' : 'muted'}">${assoc ? (assoc.method === 'manual' ? '人工纠错已确认' : '候选已确认') : '待确认（不提示）'}</span>
        <span class="hz-meta-line">${esc(stateLbl)}</span>
        <span class="hz-meta-line" style="margin-left:auto">点击展开 ${cands.length} 个候选与距离依据 ▾</span>
      </div>
      <div class="hz-obs-body">
        <p class="hz-meta-line">观察点 (${obs.point[0]},${obs.point[1]}) 层${obs.level} ｜ 缓冲半径 ${obs.radius}m ｜ 影响范围 ±${obs.impactMeters / 2}m ｜ 来源：${esc(obs.source)} ｜ 观察时点 ${fmtDate(obs.observedAt)}</p>
        <p class="hz-meta-line">有效区间：${fmtDate(obs.startAt)} ～ ${obs.endAt ? fmtDate(obs.endAt) : '长期'} ${obs.construction ? '｜施工类：过期=信息待更新，不等于安全' : ''}</p>
        <p class="hz-note">${esc(obs.note)}</p>
        <table class="hz-cands">
          <thead><tr><th>#</th><th>路线版本</th><th>候选段</th><th>证据层</th><th>投影距离</th><th>候选里程</th><th>投影点</th><th>操作</th></tr></thead>
          <tbody>${candRows}</tbody>
        </table>
        <div class="row">
          <label class="hz-meta-line">候选都不对？手工指定真实路段：
            <select class="hz-manual-select">${segOptions}</select>
          </label>
          <button class="hz-btn hz-warn" data-act="manual">人工纠错采用</button>
          <button class="hz-btn hz-danger" data-act="reject" ${assoc ? '' : 'disabled'}>撤销确认/拒绝候选</button>
        </div>
        <div class="row">
          <span class="hz-meta-line">现场回访：</span>
          <button class="hz-btn hz-ok" data-act="revisit" data-conc="present">仍存在</button>
          <button class="hz-btn hz-danger" data-act="revisit" data-conc="absent">否定（停止提示）</button>
          <button class="hz-btn" data-act="revisit" data-conc="cleared">确认已恢复</button>
        </div>
        ${revisits ? `<ul style="margin-top:.4rem">${revisits}</ul>` : ''}
        ${assoc ? `<p class="hz-meta-line" style="margin-top:.4rem">确认依据：${esc(assoc.provenance.note)}；自动距离 ${assoc.provenance.candidateDistance.toFixed(1)}m；${assoc.provenance.candidateSameLevel ? '同层' : '异层'}；确认人 ${esc(assoc.confirmedBy)} @ ${fmtDate(assoc.confirmedAt)}</p>` : ''}
      </div>
    </div>`;
  }).join('');

  tbody.querySelectorAll('.hz-obs-head').forEach((h) => {
    h.addEventListener('click', () => {
      const box = h.closest('.hz-obs');
      const open = box.classList.toggle('open');
      h.setAttribute('aria-expanded', String(open));
    });
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h.click(); } });
  });
  tbody.querySelectorAll('.hz-obs').forEach((box) => {
    const obsId = box.getAttribute('data-obs');
    box.querySelectorAll('[data-act="confirm"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        actions.onConfirm(obsId, btn.getAttribute('data-route'), Number(btn.getAttribute('data-version')), btn.getAttribute('data-seg'));
      });
    });
    box.querySelector('[data-act="manual"]').addEventListener('click', () => {
      const raw = box.querySelector('.hz-manual-select').value;
      const [rvk, segKey] = raw.split('|');
      const [routeId, version] = rvk.split('@');
      actions.onManual(obsId, routeId, Number(version), segKey);
    });
    box.querySelector('[data-act="reject"]').addEventListener('click', () => actions.onReject(obsId));
    box.querySelectorAll('[data-act="revisit"]').forEach((b) => {
      b.addEventListener('click', () => actions.onRevisit(obsId, b.getAttribute('data-conc')));
    });
  });
}

// 状态序列化（编辑持久化）：只存观察记录与启用版本
function serializeState(store) {
  return {
    activeVersions: store.activeVersions,
    observations: store.observations.map((o) => (o.__seed
      ? { id: o.id, revisits: o.revisits, association: o.association, candidatesReviewed: o.candidatesReviewed ?? null }
      : { id: o.id, full: o })),
  };
}
function restoreState(store, data) {
  store.activeVersions = data.activeVersions;
  data.observations.forEach((saved) => {
    let obs = store.observations.find((o) => o.id === saved.id);
    if (!obs && saved.full) {
      obs = { ...saved.full, candidates: [] };
      store.observations.push(obs);
    }
    if (!obs) return;
    if (saved.full) return; // 新增对象已含全部字段
    obs.revisits = saved.revisits || [];
    obs.association = saved.association;
    obs.candidatesReviewed = saved.candidatesReviewed;
  });
  refreshCandidates(store.observations, store.routes);
  const filterSel = document.getElementById('hzRouteFilter');
  populateVersionControls(store);
}


function populateVersionControls(store) {
  const sel = document.getElementById('hzVersionSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="1">滨河南路 v1（改线前）</option><option value="2">滨河南路 v2（S2 绕行 / S3 取消）</option>';
  sel.value = String(store.activeVersions['R-binhe'] ?? 2);
}
