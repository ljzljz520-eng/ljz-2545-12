# 路口提示服务（坡道 / 窄桥 / 照明）

为慢行（轮椅、助行、推婴儿车、夜间步行）用户提供的**路口受影响路段提示**。
纯前端 ES 模块 + 一份 PostGIS 建表脚本；无构建、无第三方依赖。

## 运行

```bash
# 静态站点需要通过 HTTP 打开（ES 模块在 file:// 下会被 CORS 拦截）
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000/hazards.html

# 算法与语义测试（26 个用例）
node hazards/tests/index.js
```

## 需求 → 实现对照

| 需求 | 实现 |
| --- | --- |
| 地图 + 可读列表呈现坡道、窄桥、照明记录 | `hazards.html`：SVG 地图与列表并排；`src/view.js` 为纯视图模型 |
| 后台保存观察点、影响范围、有效区间 | `model.js#createObservation`（`impactMeters`/`startAt`/`endAt`）；后台面板 + 新增表单；PostGIS `observations` |
| 空间数据库关联路线版本 | `road_segments`（稳定身份）× `route_version_segments`（版本几何）× 候选/确认表；`schema/postgis.sql` |
| 点到折线最近投影可能落在桥下道路或折返另一段 | `geometry.js#nearestOnPolyline` 返回**全部候选**（等距并列不收敛），层级 `level` 独立 |
| 自动关联保留候选与距离依据，编辑确认后才提示 | `association.js`（候选含距离/层级/里程/投影点），`advisory.js#confirmCandidate`；未确认 `association=null` 时 `buildAdvisories` 不产出 |
| 圆形缓冲匹配 vs 道路段身份关联，分层结果 + 人工纠错 | 候选 `tier = identity / buffer`，身份命中排前；`manualConfirmSegment` 可脱离候选手工指定真实段，仍留投影距离审计 |
| 里程随路线改线重算，旧坐标不能悄悄漂移 | `route.js#recomputeForVersion`：身份保留 → 沿新版本重算并标 `migratedFromVersion`；身份消失 → `version-stale`，冻结最后有效版本/里程/点，不在地图落点 |
| 施工过期 = 信息待更新 ≠ 现场安全 | `lifecycleState → stale-construction`，继续以橙色 `needs-update` 显著提示；只有回访 `cleared` 才停 |
| 上下层重叠道路 | 种子数据：桥面 `BRD/D1@level1` 与桥下 `UND/U1@level0` 平面重合（O1/O2） |
| 双向路线 | 路线 `direction`；返程里程由 `routeVersion.length - m` 换算，受影响段身份不变 |
| 提示有效期交叠 | O4（长期照明）与 O6（施工坡道）在 S2 交叠，确认后各自一条提示，不合并 |
| 回访否定旧记录 | O8 `absent`：立即不提示，记录保留；`present` 不能替代路段确认 |
| 离线缓存过期 | `cache.js#OfflineCache` 三态 `fresh/expired/missing`；过期仍可参考但 UI 强标注，不伪装成新数据；另有 `sw.js` 外壳缓存 |
| 前端展示来源和时点 | 列表每条显示来源、观察时点、有效区间；迁移/过期/stale 均有解释 |
| 屏幕阅读器定位同一受影响段 | 列表项与地图段共享 `anchor`（`<obsId>@<segmentKey>`），双向 focus 联动 + `aria-live` 播报；地图段有描述性 `aria-label` |
| 不把提示扩散到全部路线 | 视图按段点亮（`affected` 仅在确认段上为真）；未受影响段保持中性色 |

## 演示数据（固定演示时点 2026-10-01）

- **O1** 桥面窄桥（level 1）：identity 命中桥面 D1；桥下 U1 同为缓冲候选但异层，不采信。
- **O2** 桥下陡坡道（level 0）：自动几何首选错落到桥面 D1 → 已由编辑**手工纠错**到 U1（地图虚线显示观察点→实际采用投影点的依据）。
- **O3** 环山折返步道照明：观察点与 F1/F3 平面等距 → 人工确认真实折返段 F3。
- **O4** 滨河 S2 照明：切到 v2（S2 绕行）后里程 150m→约 153.9m（中心点随版本几何变化，可追溯，非漂移）。
- **O5** 滨河 S3 坡道：S3 在 v2 被取消 → `version-stale`，空心问号、不给新坐标、不扩散。
- **O6** 与 O4 交叠的施工坡道：初始 **pending**（后台确认前前端不提示），确认后同段两条并存。
- **O7** 施工记录公示 9/1 结束、无回访 → **施工已过期·信息待更新**，仍橙色提示。
- **O8** 回访否定；**O9** 回访确认恢复：均不再提示，记录保留在后台。

## 目录

```
hazards/
├── README.md
├── package.json
├── sw.js                     # 应用外壳离线缓存（数据新鲜度仍由 cache.js 管）
├── css/hazards.css
├── schema/postgis.sql        # 路线/版本/稳定身份/候选/确认/回访 + v_active_advisories
├── src/
│   ├── geometry.js           # 投影、折线里程、沿里程定位（多候选）
│   ├── model.js              # 领域模型与演示数据
│   ├── association.js        # identity/buffer 分层候选
│   ├── route.js              # 版本迁移与里程重算
│   ├── advisory.js           # 确认/纠错/回访/有效期/提示生成
│   ├── cache.js              # 带 TTL 的离线缓存
│   ├── view.js               # 纯视图模型（地图层 + 列表锚点）
│   └── ui.js                 # DOM 渲染与后台交互
└── tests/                    # node tests/index.js，零依赖断言
```

## 关键不变量（测试守护）

1. `association != confirmed` ⇒ 不出现在用户提示。
2. 提示一定能解析到**具体 segmentKey 与里程区间**；`version-stale` 的 `segment=null`。
3. 路线上未受影响段 `affected=false`；交叠提示条数 = 记录条数。
4. `absent/cleared` 回访后不再提示；施工过期仍提示且文案不等于“已安全”。
5. 反向里程与正向里程关于路线全长对称，锚点段不变。
