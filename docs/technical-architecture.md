# 本地字体管理器技术方案

## 1. 结论

使用 **Electron + Vue 3 + Node.js + pnpm** 开发该产品是合理的，能够覆盖字体库管理、海量列表、全文检索和应用内无安装预览等核心能力。

唯一不能用纯 Web/Node.js 方案可靠完成的是“让 Photoshop 等其他进程临时使用字体”。该能力必须通过独立的系统激活层实现：

- Windows：调用 `AddFontResourceExW` / `RemoveFontResourceExW` 并广播 `WM_FONTCHANGE`。
- macOS：调用 Core Text 的 `CTFontManagerRegisterFontsForURL` / `CTFontManagerUnregisterFontsForURL`，使用 session scope。
- Linux：没有统一、可靠、面向已运行第三方应用的会话级字体注册 API。可以通过 Fontconfig 临时配置启动目标应用，或临时写入用户字体目录并刷新缓存，但后者只能做到尽力而为，不能保证所有已运行应用立即刷新。

因此建议将产品承诺定义为：

- 应用内预览在三平台均不安装字体、不修改系统字体目录，退出后无字体残留。
- Windows 和 macOS 支持可靠的会话级系统激活与自动回收。
- Linux 支持“随本应用启动目标软件”的隔离激活模式，并将面向任意已运行应用的激活标记为实验性能力。

## 2. 设计目标

### 2.1 功能目标

- 管理数万至十万级字体文件及字体 face。
- 冷启动优先展示已有索引，不因目录扫描阻塞界面。
- 支持名称、厂商、语言、格式、标签、收藏和备注等组合检索。
- 预览字体时不调用系统安装或激活 API。
- 系统激活只回收本次会话中由本应用成功注册的字体。
- 正常退出、主进程崩溃和下次启动恢复时均执行激活清理。
- 核心业务、数据模型和 UI 跨平台，系统激活使用平台适配器。

### 2.2 非目标

- 首版不承担字体编辑、格式转换和字体修复。
- 不承诺绕过字体自身的许可或嵌入限制。
- 不通过复制文件到系统字体目录实现 Windows/macOS 激活。
- 不保证 Linux 上所有已经运行的第三方应用能动态刷新字体列表。

## 3. 总体架构

```text
+---------------- Vue 3 Renderer ----------------+
| 虚拟列表 | 搜索筛选 | 详情编辑 | FontFace 预览 |
+----------------------|--------------------------+
                       | typed IPC
+---------------- Electron Main ------------------+
| 应用生命周期 | 查询服务 | 文件授权 | 激活协调器 |
+----------|---------------|---------------|-------+
           |               |               |
     SQLite/FTS5      Scanner Workers    Local IPC
                           |               |
                    字体解析与哈希     Activation Agent
                                           |
                          Windows / macOS / Linux adapter
```

### 3.1 进程职责

#### Renderer

- Vue 3 页面和状态管理。
- 使用虚拟列表只渲染可见项。
- 通过 CSS `FontFace` API 按需加载应用内预览字体。
- 不直接访问文件系统、数据库或 Node.js API。

#### Electron Main

- 创建窗口、注册安全协议、处理应用生命周期。
- 提供经过校验的 IPC 接口。
- 执行 SQLite 查询和事务。
- 调度扫描 worker 和系统激活代理。
- 不在主线程执行字体解析、全文件哈希或大目录遍历。

#### Scanner Worker

- 增量扫描字体目录。
- 提取字体元信息、字符覆盖范围和可变轴信息。
- 计算稳定标识和文件哈希。
- 批量提交索引结果，避免逐条事务。

优先使用 Node.js `worker_threads`；若某个解析库存在不稳定原生代码，则将解析器迁移到 Electron `utilityProcess`，让单个坏字体最多导致解析进程退出。

#### Activation Agent

- 独立于 Electron 主进程存活，实际持有系统字体注册。
- 通过带随机会话令牌的 named pipe 或 Unix domain socket 接收命令。
- 监控 Electron 主进程 PID；主进程异常退出后立即回收本会话注册。
- 维护最小化的激活日志，仅撤销本代理确认注册成功的记录。
- 不删除用户原有字体文件，也不卸载本应用启动前已经存在的字体。

该组件需要少量平台原生代码或原生可执行程序。这不改变 Electron、Vue 3、Node.js 和 pnpm 作为产品主体技术栈的选择。

## 4. 推荐工程结构

```text
apps/
  desktop/
    src/main/             # Electron main
    src/preload/          # 最小化 contextBridge API
    src/renderer/         # Vue 3
packages/
  contracts/              # IPC DTO、校验 schema、公共类型
  database/               # SQLite schema、migration、repository
  font-indexer/           # 扫描、解析、哈希和去重
  activation-client/      # Node.js 激活代理客户端
native/
  activation-agent/       # 平台实现及构建脚本
docs/
pnpm-workspace.yaml
```

推荐基础依赖：

- 构建：`electron-vite`、TypeScript、pnpm workspace。
- UI：Vue 3、Vue Router；状态简单时使用组合式 API，复杂后再引入 Pinia。
- 数据库：`better-sqlite3` + SQLite FTS5，并为 Electron ABI 配置 rebuild/prebuild。
- 校验：`zod` 或同类 schema 库，IPC 两端共享 DTO。
- 字体解析：先验证 `fontkit` 对目标格式的覆盖率；不能稳定处理的格式交由 FreeType/HarfBuzz 原生解析器。
- 测试：Vitest、Playwright Electron 测试、平台原生集成测试。

不要让数据库库或字体解析库直接进入 renderer bundle。

## 5. 海量字体索引与启动性能

### 5.1 启动路径

启动时只执行以下同步关键路径：

1. 打开 SQLite，应用必要 migration。
2. 读取上次保存的筛选条件和首屏查询。
3. 创建窗口并展示数据库中的已有结果。
4. 在后台启动目录差异扫描。

不得在显示窗口前重新遍历字体目录。首次使用时可以立即展示空状态和扫描进度，扫描结果分批进入列表。

### 5.2 增量扫描

每个文件保存以下快速指纹：

- 规范化路径。
- 文件大小。
- 最后修改时间。
- 文件系统可用时保存 inode/file ID。

只有快速指纹变化时才重新解析并计算 SHA-256。扫描采用有界并发，避免机械硬盘随机读取、网络盘阻塞和大量字体同时解析导致内存峰值。

文件 watcher 只用于快速发现变化，定期或手动执行完整 reconciliation 作为最终一致性保障。不能把 watcher 当成唯一数据源，因为目录事件可能丢失。

### 5.3 字体与 face

一个字体文件可能包含多个 face，例如 TTC/OTC 集合。数据库中必须区分：

- `font_file`：磁盘上的物理文件。
- `font_face`：文件内可选择和预览的具体 face。

稳定标识建议由 `file SHA-256 + face index` 构成。名称不适合作为主键，因为重名字体、不同版本和本地化名称都很常见。

### 5.4 列表渲染

- 使用支持动态行高或固定行高的虚拟列表。
- 查询采用 cursor/keyset pagination，不使用深分页 `OFFSET`。
- 数据库排序后只返回当前窗口所需字段。
- 输入搜索增加短防抖，并取消过期查询。
- 不为全部字体提前生成 DOM、Canvas 或 `FontFace`。
- 首屏字体优先加载；滚动中的预览请求应可取消并限制并发。

## 6. 零污染应用内预览

### 6.1 实现方式

应用内预览不需要系统安装字体。推荐流程：

1. Main 注册标准、安全的自定义协议，例如 `font-preview://face/<id>`。
2. Renderer 根据 face ID 创建唯一 CSS family 名称，例如 `fontral_<faceId>`。
3. Renderer 使用 `new FontFace(family, 'url(...)', descriptors)` 加载字体。
4. `font.load()` 成功后加入 `document.fonts`，仅应用于对应预览行。
5. 字体移出可见区并超过 LRU 上限后，调用 `document.fonts.delete(fontFace)` 释放引用。

自定义协议只能根据数据库 ID 读取已授权字体文件，不能接受任意路径，防止 renderer 借此读取用户其他文件。协议处理器需要支持 Range/流式响应，并设置正确 MIME 类型。

### 6.2 内存控制

几万款字体不能同时加载到 Chromium。应维护可配置的 LRU，例如仅保留最近 50 至 150 个已加载 face，并结合以下策略：

- 可见区加少量 overscan。
- 快速滚动期间使用系统字体显示名称，滚动停止后再加载预览。
- 单字体设置大小上限，异常大文件显示错误状态。
- 同一个 face 的并发请求合并。
- 切换预览文本不重新加载字体，只更新文本节点。

### 6.3 格式与兼容性

Chromium 通常可直接预览常见的 TTF、OTF、WOFF 和 WOFF2，但不能假定所有桌面字体都能被浏览器整形引擎接受。索引阶段应记录格式和解析状态；预览失败时显示原因，不自动安装或转换源文件。

可变字体应读取 axis，允许用户调整 `font-variation-settings`。TTC/OTC 需要验证 Chromium 对具体 face 选择的支持；若 URL 无法准确选择集合内 face，可在内存或缓存目录生成仅供应用读取的临时子集。该缓存必须位于应用 cache 目录，可随时重建，不能写入系统字体目录。

## 7. 临时系统激活

### 7.1 通用状态机

```text
inactive -> activating -> active -> deactivating -> inactive
                 |                         |
                 +-------> failed <--------+
```

激活请求必须包含 `face/file ID`、规范化路径、文件哈希和会话 ID。代理按会话记录：

- 激活前系统查询结果。
- 实际调用的平台 API 和参数。
- 注册是否成功。
- 本会话成功增加的引用次数。
- 清理状态和最后错误。

只有“本代理调用成功”的记录才能进入待清理集合。清理操作基于该集合，而不是基于“当前系统中是否能看到某字体”。这是避免误卸载用户原有字体的核心规则。

系统 API 的实际注册粒度通常是物理字体文件，而不一定是单个 face。对于 TTC/OTC，用户激活集合中的一个 face 时可能同时让同文件中的其他 face 可见；激活记录应以 `font_file` 为所有权和引用计数单位，UI 需要明确展示这一行为。

### 7.2 Windows

建议实现：

- 使用 `AddFontResourceExW(path, 0, nullptr)` 注册到当前登录会话，使其他进程可见。
- 不使用 `FR_PRIVATE`，因为它只允许当前进程使用，不满足 Photoshop 等外部软件的需求。
- 按成功增加的引用次数调用对应次数的 `RemoveFontResourceExW`。
- 激活和停用后广播 `WM_FONTCHANGE`。
- 不向字体注册表项写值，不复制到 Windows Fonts 目录。

注意事项：

- 某些应用只在启动时枚举字体，可能需要重启目标应用。
- 相同 PostScript name 的不同字体版本可能冲突。默认应阻止激活并明确提示，而不是猜测系统会选择哪个版本。
- 对注册失败、受保护字体和损坏字体返回可诊断错误。

### 7.3 macOS

建议通过 Core Text 以 session scope 注册：

- 激活：`CTFontManagerRegisterFontsForURL`。
- 停用：`CTFontManagerUnregisterFontsForURL`。
- 注册前读取 descriptor/PostScript name 并检查冲突。
- 只对本会话注册成功的 URL 执行 unregister。

应用签名、Hardened Runtime 和打包后的 helper 权限需要在 CI 中验证。若计划上架 Mac App Store，还必须单独验证 sandbox 对外部字体文件访问和 session scope 注册的限制；非商店签名分发更适合该类桌面工具。

### 7.4 Linux

Linux 建议提供两个明确区分的模式：

#### 隔离启动模式（推荐）

- 在 `$XDG_RUNTIME_DIR` 创建临时 Fontconfig 配置和字体目录。
- 设置 `FONTCONFIG_FILE` / `FONTCONFIG_PATH` 后，由本应用启动目标软件。
- 子进程及其后代能看到临时字体，其他应用不受影响。
- 退出目标进程和本应用后删除 runtime 文件。

该模式最接近“零污染”，但不能让已经运行的任意软件获得字体。

#### 桌面会话模式（实验性）

- 在应用专属的用户字体目录中创建受管理的副本或链接。
- 执行 `fc-cache` 刷新。
- 清理时只删除本应用创建且哈希匹配的条目，再次刷新缓存。

该模式可能产生 Fontconfig 缓存，且不同桌面应用的刷新行为不一致，因此不能宣称与 Windows/macOS 等价。实现前应通过产品文案向用户说明限制。

### 7.5 防止误卸载

必须同时遵守以下规则：

- 激活前即时查询系统字体，不只依赖应用启动时快照。
- 若相同文件/哈希已经由系统提供，标记为 `already_available`，不注册也不清理。
- 若 PostScript name 相同但哈希或版本不同，默认报告冲突并阻止激活。
- 每次平台注册调用都保存成功计数，停用只减少本会话增加的计数。
- 从不删除非应用专属目录中的文件。
- 删除应用专属文件前再次校验路径归属、文件 ID 和哈希，防止路径替换或符号链接攻击。

### 7.6 异常退出清理

只监听 Electron 的 `before-quit`/`will-quit` 不够，因为进程崩溃、强制结束和 renderer/main 致命错误可能绕过钩子。

推荐清理链路：

1. Activation Agent 是实际注册者，并持续监控 Main PID。
2. 正常退出时 Main 请求 `deactivateAll`，等待代理确认后再结束。
3. Main 异常退出时代理检测到进程句柄或 PID 消失，立即执行 `deactivateAll`。
4. 代理使用原子写入的 session journal 记录未完成清理。
5. 下次启动先读取并恢复残留会话，再允许新的激活操作。
6. 操作系统关机或宕机属于最后兜底边界；会话级注册应在重启后失效，应用专属临时文件在下次启动时清扫。

不能对断电场景承诺磁盘上绝对不存在 journal/cache 文件，但必须保证字体不被持久安装，且残留元数据可安全重建和清理。

## 8. 数据库设计

数据库放在 Electron `userData` 目录，启用 WAL、foreign keys 和 migration。源字体文件不存入数据库。

建议核心表：

```text
library_root
  id, path, enabled, scan_status, last_scanned_at

font_file
  id, root_id, path, normalized_path, size, mtime_ms,
  file_id, sha256, format, parse_status, parse_error,
  discovered_at, updated_at, missing_at

font_face
  id, file_id, face_index, family, subfamily, full_name,
  postscript_name, localized_names_json, version, vendor,
  weight, width, slant, is_variable, axes_json,
  unicode_ranges, glyph_count

tag
  id, name, normalized_name, color

font_tag
  face_id, tag_id

font_user_data
  face_id, favorite, note, rating, updated_at

activation_session
  id, agent_pid, platform, started_at, ended_at, recovery_state

activation_record
  id, session_id, file_id, face_id, path, sha256,
  platform_token, state, owned_ref_count, last_error
```

### 8.1 全文检索

使用 FTS5 建立面向 face 的搜索文档，包含：

- family、subfamily、full name、PostScript name。
- 本地化名称和厂商。
- 标签名称。
- 用户备注。

收藏、格式、字重、可变字体、语言覆盖等结构化条件使用普通索引过滤，不要全部塞入 FTS。标签或备注更新后在同一事务中同步搜索索引。

### 8.2 删除与移动

- 文件暂时不可访问时先标记 `missing_at`，不要立即删除用户标签、收藏和备注。
- 重新出现相同哈希的字体时恢复关联。
- 相同内容位于多个路径时保留文件实例，但可在 UI 中按 hash 聚合。
- 用户数据优先绑定稳定 face 身份；设计 migration 时要考虑文件移动和重新扫描。

## 9. IPC 与安全

Electron 必须使用以下基线：

- `contextIsolation: true`。
- `nodeIntegration: false`。
- renderer sandbox 开启。
- preload 只暴露小型、显式、类型化 API。
- 所有 IPC 参数在 Main 端重新校验。
- CSP 禁止任意远程脚本和不必要的 `eval`。
- 导航、窗口打开和外部链接使用白名单。

建议 preload API 按领域划分：

```text
fonts.query(input)
fonts.get(id)
fonts.updateUserData(input)
fonts.addTags(input)
library.addRoot()
library.rescan(rootId)
activation.activate(faceId)
activation.deactivate(faceId)
activation.list()
```

Renderer 不应传递待执行 SQL、任意文件路径、shell 命令或平台 API 参数。

字体文件是不可信输入。解析应设置文件大小、执行时间、集合 face 数量和元数据长度上限；崩溃隔离优先于在主进程内追求少量性能收益。

## 10. 性能目标

以下指标可作为首版验收基线，最终数值应在目标硬件上通过基准测试校准：

- 已有 50,000 个 face 时，窗口在 2 秒内可交互并展示缓存首屏。
- 常用名称或标签查询 P95 小于 100 ms。
- 列表持续滚动时 UI 保持 50 FPS 以上，主线程无持续 50 ms 以上长任务。
- 常见本地字体首个预览 P95 小于 300 ms，已缓存切换文本小于一帧至数帧。
- 后台扫描不阻塞查询和 UI，内存随字体总数近似由索引结果而非字体二进制体积决定。
- 正常退出时已激活字体全部回收；Main 被强制结束后代理在数秒内开始回收。

基准数据集应包含 TTF、OTF、TTC、可变字体、CJK 大字体、损坏文件、重名和重复文件。

## 11. 关键风险与决策

| 风险 | 影响 | 决策 |
| --- | --- | --- |
| 同时加载大量 FontFace | Chromium 内存过高、滚动卡顿 | 虚拟列表 + 可见区加载 + LRU |
| 启动时全量扫描 | 冷启动慢 | SQLite 先展示，后台增量扫描 |
| 字体解析器被坏文件击穿 | 主进程崩溃 | worker/utilityProcess 隔离和资源限制 |
| 仅依赖 Electron 退出事件清理 | 崩溃后字体残留 | 独立 Activation Agent + journal |
| 重名字体误卸载 | 影响用户原字体 | 成功调用所有权记录、引用计数、冲突阻止 |
| Linux 行为不统一 | 无法满足全部第三方软件 | 推荐隔离启动模式，桌面模式标记实验性 |
| `better-sqlite3` Electron ABI | 安装或升级失败 | 固定版本、CI rebuild、发布预构建产物 |
| 原生 helper 被安全软件拦截 | 激活不可用 | 签名、公证、稳定 IPC、明确错误诊断 |

## 12. 分阶段实施

### Phase 1：可行性验证

- 建立 Electron + Vue 3 + pnpm workspace。
- 验证 10,000 至 50,000 行虚拟列表。
- 验证 TTF/OTF/TTC/可变字体的元信息解析。
- 验证自定义协议 + `FontFace` 的应用内预览和 LRU 释放。
- 分平台制作最小激活/停用原型，重点验证 Photoshop 或同类目标应用。
- 在 Linux 上验证两种模式并确定产品承诺。

该阶段应优先完成系统激活 spike。它是整套方案中风险最高、最不适合后期才验证的部分。

### Phase 2：索引与管理 MVP

- SQLite schema、migration、FTS5。
- 增量扫描、重复检测、文件缺失恢复。
- 搜索、筛选、标签、收藏、备注。
- 虚拟列表和自定义预览文本。

### Phase 3：可靠激活

- Activation Agent 和安全 IPC。
- Windows/macOS 正式适配器。
- 激活 journal、PID 监控、异常恢复和冲突检测。
- Linux 隔离启动模式；根据验证结果决定是否发布桌面会话模式。

### Phase 4：发布质量

- 大规模性能基准和损坏字体 fuzz/回归集。
- 自动更新、数据库备份和 migration 回滚策略。
- Windows 签名、macOS 签名与 notarization。
- 三平台安装包、升级和卸载测试。

## 13. 验收测试重点

- 导入 50,000 个 face 后重启，确认首屏不等待重新扫描。
- 快速滚动数分钟，确认 DOM 数量、已加载 FontFace 数量和内存受控。
- 连续修改预览文本，确认不会触发系统字体安装或磁盘复制。
- 激活字体后在目标第三方软件中使用，再停用并确认字体不可继续新建使用。
- 对系统已安装的同一字体执行激活/退出，确认原字体仍存在。
- 对相同 PostScript name 的不同版本执行激活，确认默认阻止并提示冲突。
- 正常退出、强杀 Main、Main 崩溃、代理重启和系统重启后分别验证清理。
- 扫描损坏字体、超大字体、TTC 多 face、断开的符号链接和无权限目录，确认主进程不崩溃。
- 数据库升级后确认标签、收藏、备注和缺失文件关联不丢失。

## 14. 最终建议

该方案适合进入开发，但应把下面三项作为架构前置条件，而不是后期优化：

1. 应用内预览与系统激活完全分离，预览永远只使用 Chromium `FontFace`。
2. 系统注册由独立 Activation Agent 持有，不能仅靠 Electron 退出钩子清理。
3. 在产品定义中明确 Linux 的能力边界，不承诺无法由操作系统保证的全局实时激活。

满足这些条件后，Electron/Vue 的开发效率与 SQLite、后台 worker、少量平台原生适配相结合，可以在性能、跨平台和系统安全之间取得合理平衡。
