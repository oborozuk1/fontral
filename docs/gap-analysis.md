# 实现差距分析（对照 `technical-architecture.md`）

本文对照 `docs/technical-architecture.md` 检视当前代码实现，列出**未做到 / 做得不到**的部分。每条尽量给出代码位置，便于后续整改。

代码基线：当前仓库 `apps/desktop`、`packages/{contracts,database,font-indexer}`。

## 0. 总览

| 维度 | 状态 |
| --- | --- |
| Electron + Vue 3 + pnpm workspace | 已落地 |
| `font_file` / `font_face` 分离、FTS5、keyset 分页 | 已落地 |
| `worker_threads` 增量扫描 + 指纹去重 | 已落地 |
| `font-preview://` 自定义协议 + `FontFace` + LRU 预览 | 已落地 |
| Windows / macOS / Linux 系统激活 | **有最小实现，但偏离架构核心约束** |
| Activation Agent（独立进程 / PID 监控 / journal） | **完全缺失** |
| 自动化测试 | **完全缺失** |
| 打包 / 签名 / 自动更新 | **完全缺失** |
| Linux 隔离启动模式 | **未实现**（只做了桌面会话模式） |
| 渲染器 sandbox | **显式关闭** |

整体定位：**Phase 2 MVP 水平**，Phase 3（可靠激活）和 Phase 4（发布质量）基本未启动。

---

## 1. 工程结构（对照 §4）

文档推荐结构：

```text
packages/
  contracts/
  database/
  font-indexer/
  activation-client/      # ❌ 未实现
native/
  activation-agent/       # ❌ 未实现
```

实际仓库只有 `packages/{contracts,database,font-indexer}`，没有 `activation-client`，也没有顶层 `native/` 目录。

- `apps/desktop/package.json` 的 `scripts` 只有 `dev / build / typecheck / rebuild:native`，**没有 `test`**。
- 没有 `electron-builder` / `electron-forge` 配置，无法产出三平台安装包。

---

## 2. 进程职责与 Activation Agent（对照 §3.1、§7、§11）—— **最大缺口**

文档要求系统激活由**独立于 Electron 主进程**的 Activation Agent 持有，并通过 PID 监控 + 原子 journal 保证崩溃回收。当前实现完全没有这一层。

### 2.1 现状
激活逻辑直接写在主进程里：
- Windows：`apps/desktop/src/main/index.ts:515-536`，用 `powershell.exe -EncodedCommand` 调 C# P/Invoke `AddFontResourceEx` / `RemoveFontResourceEx` + 广播 `WM_FONTCHANGE`。
- macOS：`apps/desktop/src/main/index.ts:537-547`，`osascript -l JavaScript` 调 `CTFontManagerRegisterFontsForURL` / `…UnregisterFontsForURL`，scope 为 session。
- Linux：`apps/desktop/src/main/index.ts:549-565`，软链到 `$XDG_DATA_HOME/fonts/Fontral/` 并 `fc-cache -f` —— 对应文档 §7.4 的"桌面会话模式（实验性）"，**不是**推荐的"隔离启动模式"。
- 状态：`apps/desktop/src/main/index.ts:33-34` 仅在内存中维护 `activeFaces: Map<number, { path; link? }>`。

### 2.2 与文档要求的差距
| 文档要求（§3.1、§7.1、§7.5、§7.6） | 实际 |
| --- | --- |
| Agent 是独立进程，存活于 Main 之外 | ❌ 在 Main 进程内执行 |
| Agent 监控 Main PID，PID 消失立即回收 | ❌ 无 |
| named pipe / Unix domain socket + 随机会话令牌 | ❌ 无 |
| 原子写入的 session journal | ❌ 无；仅 Linux 启动时 `rmSync` 清目录（`main/index.ts:588-592`） |
| 激活前即时查询系统字体，命中即 `already_available` 短路 | ❌ `runActivation` 无条件调用系统 API（`main/index.ts:619-624`） |
| PostScript name 冲突检测 + 默认阻止 | ❌ 无 |
| 以 `font_file` 为引用计数单位，按成功次数回收 | ❌ 每个 faceId 一条记录，无计数 |
| 不卸载用户原有字体 / 应用专属文件删除前再次校验哈希与 file ID | ❌ 无校验，存在误删风险 |
| `before-quit` 同步等待 `deactivateAll` 完成 | ❌ `main/index.ts:876-882` 是 `void deactivateAllFonts()`，**fire-and-forget**，进程可能在 PowerShell/osascript 跑完前退出 |
| 下次启动先恢复残留会话再允许新激活 | ❌ 无 |

### 2.3 数据库缺表（对照 §8）
文档 §8 规定的 `activation_session`、`activation_record` 两张表，`packages/database/src/index.ts:79-100` 的 `migrate()` **没有创建**，激活记录无任何持久化。

### 2.4 IPC API 不完整
文档 §9 列出的 `activation.list()` 在契约里不存在（`packages/contracts/src/index.ts:257-260` 只暴露 `activate` / `deactivate`）。

### 2.5 Linux 模式缺失
文档 §7.4 把"隔离启动模式（推荐）"作为 Linux 主路径，"桌面会话模式"是实验性。当前实现只有后者，没有 `$XDG_RUNTIME_DIR` + `FONTCONFIG_FILE` 启动目标软件的隔离模式，也没有向用户说明限制的产品文案。

---

## 3. 海量字体索引与启动性能（对照 §5）

### 3.1 启动路径（§5.1）—— 基本符合
- `apps/desktop/src/main/index.ts:729-731`：开 DB → 创建窗口 → 后台 `scan(root.id)`，窗口先展示已有索引。
- ✅ 没有在窗口就绪前同步扫描目录。

### 3.2 增量扫描（§5.2）—— 部分差距
- ✅ 快速指纹：`packages/database/src/index.ts:81` 的 `font_file.size` + `mtime_ms`。
- ✅ 只有指纹变化才重新解析并算 SHA-256（`packages/font-indexer/src/worker.ts:29-32, 109-117`）。
- ✅ 有界并发：`PARSE_CONCURRENCY = max(2, min(8, cpus))`、`WALK_CONCURRENCY = max(4, min(16, cpus*2))`（`worker.ts:13-14`）。
- ❌ **没有保存 inode / file ID**（文档要求"文件系统可用时保存"）。
- ❌ **没有文件 watcher**（文档允许，但说"watcher 只用于快速发现变化，定期或手动 reconciliation 兜底"；当前只能手动/启动重扫）。
- ❌ **单文件解析无超时**，只有 200 MB 大小上限（`worker.ts:113`）和 256 face 截断（`worker.ts:131`）。坏字体若不被 fontkit 抛错而是 hang，会阻塞整个解析 worker。

### 3.3 列表渲染（§5.4）—— 关键差距：渲染端一次性 hydrate 全量
- ✅ 虚拟列表：`apps/desktop/src/renderer/src/composables/useVirtualList.ts`，固定行高 + overscan 4 行。
- ✅ keyset 分页：`packages/contracts/src/index.ts:13` 的 `cursor`、`packages/database/src/index.ts:357` 的 `ff.id > @cursor`，无任何 SQL `OFFSET`。
- ✅ 搜索防抖 150 ms + 过期查询取消（`useFonts.ts:510-535`、`refreshSeq`）。
- ❌ **渲染端"全量 hydrate"**：`useFonts.ts:208-245, 298` 会循环拉取所有分页直到 `hasMore=false`，把全部 face 物化进内存。50 000 face ≈ 100 次 IPC + 完整数组。虚拟列表只 window 了 DOM，没 window 数据。文档 §5.4 的"只返回当前窗口所需字段"在渲染端被破坏。
- ❌ 没有性能基准脚本（文档 §10 列出 50K face、P95 < 100 ms、50 FPS 等指标，但仓库无任何测量代码）。

---

## 4. 零污染应用内预览（对照 §6）

### 4.1 已落地
- ✅ 标准安全协议 `font-preview://face/<id>`：`apps/desktop/src/main/index.ts:16, 732-743`。
- ✅ 渲染端用唯一 family `fontral_${face.id}` + `new FontFace(...)`：`useFontPreview.ts:211-212`。
- ✅ `document.fonts.add/delete`：`useFontPreview.ts:216, 223, 131`。
- ✅ LRU + 并发上限：`CACHE_MAX = 64`、`MAX_CONCURRENT = 3`（`useFontPreview.ts:8-10`）。
- ✅ 滚动空闲再加载、可视区保护、prefetch：`useFontPreview.ts:140-166, 350-366`。
- ✅ 协议只接受 face ID，路径不可由渲染端控制；200 MB 上限；`cache-control: no-store`。

### 4.2 差距
- ⚠️ **字符集模态框里的第二个 FontFace 加载没有走 LRU**：`apps/desktop/src/renderer/src/components/FontDetailPanels.vue:79-89` 只检查 `document.fonts` 是否已存在就 `add`，没有计入 LRU，也没在关闭时 `delete`，存在长期泄漏风险。
- ⚠️ **可变字体 axis 在预览里没有暴露 `font-variation-settings`**（文档 §6.3）。`axes_json` 已在索引阶段入库（`packages/database/src/index.ts:82`），但 `useFontPreview.ts:212` 的 `new FontFace` 没传 descriptors，渲染端也没 UI 调节轴。
- ⚠️ **TTC/OTC 集合内 face 的预览未经验证**：协议仅按 face_id 取整个文件 URL，依赖 Chromium 自行选 face。文档 §6.3 明确要求"若 URL 无法准确选择集合内 face，应在缓存目录生成临时子集"，当前没有这套 fallback。
- ⚠️ **预览失败时未展示原因**：`useFontPreview.ts` 在 coverage 失败时改写为 `\uFDD0` 标记字符，但 `font.load()` reject 的具体原因（损坏 / 格式不支持 / 超大）没有传递到 UI。

---

## 5. 数据库设计（对照 §8）

### 5.1 已落地
- ✅ WAL + foreign_keys（`packages/database/src/index.ts:74-75`）。
- ✅ 核心表 `library_root / font_file / font_face / font_user_data / font_search(FTS5) / font_tag / font_face_tag` 都齐了。
- ✅ FTS5 字段含 family、subfamily、full_name、postscript_name、note、localized_names（`index.ts:84`）。
- ✅ 文件不可达先标 `missing_at`，不立刻删用户数据（`index.ts:252-269`）。
- ✅ 标签、备注、语言按 family 共享（`index.ts:484-501, 503-557`）。

### 5.2 差距
- ❌ **缺 `activation_session` / `activation_record` 表**（见 §2.3）。
- ❌ **没有独立 migration 目录**，全部内联在 `Database.migrate()`（`index.ts:78-134`）。后续 schema 演进、回滚、备份策略（文档 §12 Phase 4）无处安放。
- ⚠️ FTS5 没有 `vendor` 字段（文档 §8.1 列入"厂商"作为检索维度）。当前 `font_face` 表本身也没有 `vendor` 列，厂商信息只能从详情接口的 `credits` 取（`main/index.ts:271-382` 的 fontkit 解析）。
- ⚠️ **没有按 hash 聚合重复文件的 UI**（文档 §8.2 "相同内容位于多个路径时保留文件实例，可在 UI 中按 hash 聚合"）。

---

## 6. IPC 与安全（对照 §9）

### 6.1 已落地
- ✅ `contextIsolation: true`、`nodeIntegration: false`（`apps/desktop/src/main/index.ts:635`）。
- ✅ preload 暴露类型化 API（`apps/desktop/src/preload/index.ts`，契约 `FontralApi`）。
- ✅ Main 端用 zod 重校验所有 IPC 输入（如 `fonts:query` → `fontQuerySchema.parse`，`fonts:family` → `fontFamilySchema.parse` + `folderFilterSchema.parse`）。
- ✅ CSP 禁远程脚本、禁 `eval`（`main/index.ts:744`）。
- ✅ 窗口/导航策略：`setWindowOpenHandler` 全 deny、`will-navigate` 全 prevent（`main/index.ts:642-643`）。
- ✅ `font-preview://` 不接受任意路径，只接受 face ID（`main/index.ts:732-743`）。
- ✅ 长度上限：note ≤ 10 000、folder/root note ≤ 200、tags ≤ 20 个 × 32 字符等。

### 6.2 差距
- ❌ **`sandbox: false`**（`main/index.ts:635`），与文档 §9 "renderer sandbox 开启"直接冲突。代码注释解释是"electron-vite 输出 ESM preload，sandbox 模式加载不了"——这是已知技术债，需要切回 CJS preload 或升级 electron-vite 配置以恢复 sandbox。
- ⚠️ **字体解析仍跑在主线程的同步 fontkit 上**：`main/index.ts:55` 的 `getDetailFont` 在 Main 同步调用 fontkit 解析详情/字符集/preview 文本重写，大 CJK 字体一次解析可能阻塞主进程上百 ms。文档 §3.1 明确"不在主线程执行字体解析"。
- ⚠️ `font-preview://` 协议没有显式设置 `Content-Security-Policy` 响应头，仅依赖全局 CSP。

---

## 7. 临时系统激活的可靠性（对照 §7.5、§7.6、§13）—— 验收必过项

文档 §13 列出的验收清单里，激活相关几乎全部不通过：

| 验收项 | 当前状态 |
| --- | --- |
| 激活后在第三方软件使用，停用后不可用 | Windows / macOS 能跑通基础路径 |
| 对系统已安装的同一字体激活/退出，原字体仍存在 | ⚠️ 无 `already_available` 检测，依赖系统去重，风险不可控 |
| 相同 PostScript name 不同版本激活，默认阻止并提示冲突 | ❌ 无冲突检测 |
| **正常退出回收** | ⚠️ `before-quit` fire-and-forget，可能没跑完就退出 |
| **强杀 Main 后回收** | ❌ Main 内执行，强杀即丢失激活状态，**字体残留** |
| Main 崩溃后回收 | ❌ 同上 |
| 代理重启后恢复 | ❌ 无代理 |
| 系统重启后清理 | ⚠️ 仅 Linux 启动时清目录；Windows/macOS 无任何处理 |
| 扫描损坏/超大/TTC/坏链/无权限目录不崩溃 | 大体可用（worker 隔离 + 200 MB 上限），但无 fuzz/回归集 |

文档 §11 风险表里"仅依赖 Electron 退出事件清理"被列为必须解决的风险，**当前实现正是这种被点名的反模式**。

---

## 8. 测试（对照 §2.1、§13）—— **完全空白**

- ❌ 全仓库无任何 `*.test.*` / `*.spec.*` 文件。
- ❌ 没有引入 Vitest、Playwright Electron、原生集成测试。
- ❌ `package.json` 无 `test` 脚本。
- ❌ 文档 §10 的性能基准数据集（TTF/OTF/TTC/可变/CJK/损坏/重名/重复）没有构造与基准代码。

---

## 9. 发布质量（对照 §12 Phase 4）—— 未启动

- ❌ 无 `electron-builder` / `electron-forge` 配置。
- ❌ 无代码签名（Windows）、无 notarization（macOS）。
- ❌ 无自动更新（electron-updater 等）。
- ❌ 无数据库备份 / migration 回滚策略。
- ❌ 无 CI 配置文件（无 `.github/workflows`、`.gitlab-ci.yml` 等）。

---

## 10. 其他可观察的小问题

- 主进程内有一份独立的 `detailFonts` LRU（`main/index.ts:36-48`，cap=6），与渲染端 LRU（cap=64）彼此独立，缓存策略不统一。
- `fontkit.d.ts` 仅 `declare module 'fontkit' { export const create: any }`（`packages/font-indexer/src/fontkit.d.ts`），fontkit 的丰富类型完全没被利用，调用侧全部 `any`，类型安全缺位。
- 所有 UI 文案硬编码简体中文，无 i18n 框架。
- `apps/desktop/src/renderer/src/App.vue` 单文件 1058 行、`FontDetailPanels.vue` 2106 行，组件拆分不足，长期维护性差。

---

## 11. 整改优先级建议

按"风险 × 架构债"排序：

1. **P0 系统激活重做**：抽出独立 Activation Agent（或 helper 可执行），加 PID 监控、原子 journal、`activation_session/record` 表、激活前系统查询、PS name 冲突检测、引用计数、`before-quit` 同步等待回收。这是文档第 14 节列出的三项"架构前置条件"之一。
2. **P0 渲染器 sandbox 重新开启**：解决 electron-vite ESM preload 问题，恢复 `sandbox: true`。
3. **P1 把详情解析从 Main 同步路径移出**：`getDetailFont` 进 worker 或 utility process。
4. **P1 渲染端数据分页**：把"全量 hydrate"改成按虚拟列表窗口懒加载，支撑 50K+ face。
5. **P2 Linux 隔离启动模式** + 产品文案说明边界。
6. **P2 引入 Vitest + Playwright Electron**，覆盖文档 §13 验收清单。
7. **P2 migration 独立目录与回滚策略**。
8. **P3 可变字体 axis 预览 UI、TTC face 选择 fallback、预览失败原因展示、按 hash 去重 UI**。
9. **P3 打包 / 签名 / 公证 / 自动更新 / CI**。

---

## 附：已落地能力一览（避免重复劳动）

- pnpm workspace + Electron 36 + Vue 3.5 + TypeScript + electron-vite
- `better-sqlite3` + WAL + FTS5，`font_file` / `font_face` 分离
- keyset 分页（`ff.id > @cursor`），无 SQL `OFFSET`
- `worker_threads` 增量扫描，size+mtime 指纹，SHA-256 去重，有界并发
- `font-preview://` 安全协议 + 渲染端 `FontFace` + LRU（cap 64）+ 并发上限 3
- IPC 全量 zod 重校验、CSP、`contextIsolation`、窗口/导航白名单
- family 共享的标签 / 备注 / 语言编辑
- Windows / macOS / Linux 基础激活（**仅作为 spike，不满足可靠性要求**）
- 自定义标题栏、托盘、文件夹树、字符集浏览、CJK 覆盖检测、高级筛选
