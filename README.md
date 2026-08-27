# 工时记录 PWA — 代码优化说明

## 本轮优化内容

| 编号 | 优化项 | 文件 | 说明 |
|---|---|---|---|
| #1 | `getSmartStepIndex` 简化 | ui.js | 移除多余 `done>=4` 守卫，直接返回 `filter(Boolean).length` |
| #2 | 当日工时缓存 | storage.js | 新增 `getTodayTotal()` + `_todayCache`，`invalidateMonthCache` 联动清空 |
| #3 | 图表 Canvas 脏检查 | chart.js | `drawChart` 增加指纹 key，状态/数据未变时跳过全量重绘 |
| #4 | 日历 DOM 节点复用 | ui.js | `_calCells` 缓存池（≤42），切换月/周只更新内容，不重建节点 |
| #7 | 按职责拆分为模块 | storage/chart/ui | 单文件 script.js → 3 个职责单一模块 + index.html 顺序引入 |

## 模块结构

```
工时记录/
├── index.html      # 入口，按 storage → chart → ui 顺序引入
├── storage.js      # 工具函数 + 数据层（localStorage / 排班 / 统计缓存）
├── chart.js        # 图表可视化（Canvas / 导出 PNG / 分享 / 达标线）
├── ui.js           # UI 渲染 + 交互 + 初始化（依赖前两者）
├── style.css       # 样式（不变）
├── sw.js           # Service Worker（不变）
├── manifest.json   # PWA 清单（不变）
├── changelog.json  # 更新日志（数据驱动）
└── version.json    # 当前版本号
```

## 模块契约（全局命名空间 `window.WT`）

| 命名空间 | 提供 | 依赖 |
|---|---|---|
| `WT.util` | `getLocalDateStr` / `getCurrentTimeStr` / `getDuration` / `getWeekRange` / `pad` | — |
| `WT.data` | `allData` / `shiftsConfig` / `getTodayTotal` / `getMonthStats` / `invalidateMonthCache` / `saveData` 等 | `WT.util` |
| `WT.chart` | `drawChart` / `initChart` / `toggleChartType` / `setChartRange` / `exportChartPNG` / `shareChartImage` / `syncChartWithCalView` | `WT.util` |
| `WT.ui` | `showToast` / `closeSettings` / `renderCalendar` / `updateStats` / `init` 等 | `WT.util` + `WT.data` + `WT.chart` |

## 加载顺序（重要）

`index.html` 中必须按 **storage.js → chart.js → ui.js** 顺序引入：
- `storage.js` 先注册 `WT.util` 与 `WT.data`（无外部依赖）
- `chart.js` 注册 `WT.chart`（依赖 `WT.util`）
- `ui.js` 最后注册 `WT.ui` 并绑定 `DOMContentLoaded` 初始化（依赖前三者）

`chart.js` 对 `WT.ui` 仅**软依赖**（`WT.ui && WT.ui.showToast`），避免循环引用；`ui.js` 通过 `WT.chart.*` 调用图表，解耦彻底。

## 部署提示

- 所有静态资源（含三个 `.js`）需置于同一目录，由 `sw.js` 预缓存清单统一缓存
- 升级版本时同步更新 `version.json` 的 `version` 字段与 `sw.js` 的 `CACHE_NAME`
- 建议通过 `http(s)` 或本地静态服务器（如 `python -m http.server`）打开，避免 `file://` 下 `localStorage` / `fetch` 受限
