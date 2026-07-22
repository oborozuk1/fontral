# 当前阶段实施清单

本文依据 `docs/technical-architecture.md` 和 `docs/gap-analysis.md`，定义项目当前阶段应完成的工作、实施顺序和验收边界。

## 实施状态（2026-07-21）

当前阶段的代码闭环已完成：

- `packages/contracts` 已定义激活状态、错误码、Renderer DTO 和 Agent 消息协议，Renderer API 已增加 `activation.list()`。
- 数据库已改为独立、带版本账本的 migration，并新增 `activation_session`、`activation_record` 及激活 repository；升级不会重建原业务表。
- `packages/activation-client` 与独立 `native/activation-agent` 已建立。Agent 使用 named pipe / Unix socket、随机会话令牌、Main PID 监控和原子 journal。
- Windows/macOS 注册 API 已移入 Agent；激活前校验文件 SHA-256、系统已有字体和 PostScript name 冲突，清理严格依据 Agent 拥有的成功引用。
- Linux 全局激活已移除，改为 `$XDG_RUNTIME_DIR` + 临时 Fontconfig 的隔离启动模式；目标退出、停用或 Main 消失后清理 runtime 目录。
- Electron Main 已删除旧激活 spike 和内存 `activeFaces`，正常退出会等待 Agent 清理完成。
- preload 已改为 CommonJS，BrowserWindow 已恢复 `sandbox: true`；Renderer 会先订阅状态事件并通过 `activation.list()` 恢复状态。
- 仓库已增加 `pnpm test`。当前 7 项测试覆盖 migration 数据保留、TTC 物理文件记录、Agent 激活生命周期、重复清理、冲突、哈希变化、超时和 Main PID 消失回收。

自动验证结果：`pnpm typecheck`、`pnpm test`、生产构建均通过；真实 Electron 启动烟测 12 秒内无启动错误（测试进程由超时器结束）。

仍需发布前人工执行：在目标 Windows/macOS 机器上使用 Photoshop 或同类第三方软件验证字体出现/消失，并在 macOS 签名产物中验证 Core Text helper 权限。该项需要对应平台和目标软件，不能由当前 Windows 自动测试替代。

## 1. 当前阶段判断

项目当前处于 **Phase 2（索引与管理 MVP）已基本完成，准备进入 Phase 3（可靠激活）** 的状态。

现阶段的主目标不是继续增加字体管理功能，也不是立即进入打包发布，而是把现有的系统激活 spike 重构为可恢复、不会误卸载用户字体的正式能力。

本阶段完成的标志：

- Windows 和 macOS 的字体激活由独立 Activation Agent 持有。
- Electron Main 正常退出、崩溃或被强杀后，已激活字体均能被回收。
- 已安装字体和 PostScript name 冲突不会被误注册或误卸载。
- 激活状态可查询、可持久化、可恢复。
- Renderer sandbox 恢复开启。
- Linux 至少完成隔离启动模式的技术闭环和产品边界定义。

## 2. 实施顺序

### 2.1 先冻结激活契约和状态模型

在编写平台代码前，先明确跨进程契约，避免平台实现反向决定业务模型。

- 在 `packages/contracts` 中补充激活 DTO、错误码和状态枚举。
- 请求至少包含 `faceId`、`fileId`、规范化路径、SHA-256 和 session ID。
- 定义 `inactive / activating / active / deactivating / failed / already_available / conflict` 状态。
- 补充 `activation.list()`，让 Renderer 可以从真实状态恢复 UI。
- 统一可诊断错误：文件缺失、哈希变化、系统已存在、PostScript name 冲突、平台注册失败、Agent 失联、清理失败。

交付物：稳定的 IPC DTO、Agent 协议和错误语义。

### 2.2 增加数据库 migration 和激活表

- 将后续 schema 变更从 `Database.migrate()` 内联 SQL 迁移到独立 migration 机制。
- 新增 `activation_session` 表，记录 session、Agent PID、平台、起止时间和恢复状态。
- 新增 `activation_record` 表，以 `font_file` 为所有权和引用计数单位。
- 记录路径、SHA-256、平台 token、状态、成功引用次数和最后错误。
- migration 必须保留现有标签、收藏、备注和字体索引数据。

交付物：可升级、可重复验证的 schema migration，以及激活状态 repository。

### 2.3 建立 Activation Agent 最小闭环

- 新建 `packages/activation-client`，负责启动 Agent、握手、命令调用、超时和断线处理。
- 新建 `native/activation-agent`，作为独立于 Electron Main 的进程。
- 使用 named pipe（Windows）或 Unix domain socket（macOS/Linux）通信。
- 每次会话生成随机令牌，Agent 校验令牌后才接受命令。
- Agent 监控 Main PID；PID 消失后立即执行 `deactivateAll`。
- 使用临时文件加原子替换写 session journal。
- 启动新会话前先恢复并清理残留 journal。
- Main 的 `before-quit` 必须等待 Agent 确认清理完成，不能 fire-and-forget。

第一步只需用 fake adapter 跑通 `activate -> list -> deactivate -> Main 被强杀后自动清理`，再接平台 API。

交付物：与平台无关、可自动测试的 Agent 生命周期闭环。

### 2.4 实现安全的激活判定

这部分必须先于正式平台适配器完成。

- 激活前即时查询系统字体，不能只依赖应用启动时快照。
- 相同文件或哈希已由系统提供时返回 `already_available`，不注册、不进入待清理集合。
- PostScript name 相同但哈希或版本不同时，默认返回 `conflict` 并阻止激活。
- 只有平台 API 明确返回成功后才增加 owned ref count。
- 停用严格按本会话成功增加的次数回收。
- TTC/OTC 按物理 `font_file` 激活和计数，UI 明确同文件其他 face 可能同时可见。
- 删除应用专属临时文件前重新校验目录归属、file ID 和 SHA-256。

交付物：不会卸载用户原有字体的所有权规则和冲突检测。

### 2.5 接入 Windows 和 macOS 正式适配器

Windows：

- 使用 `AddFontResourceExW` / `RemoveFontResourceExW`。
- 按成功引用次数执行对应次数的移除。
- 激活和停用后广播 `WM_FONTCHANGE`。
- 不写字体注册表，不复制到 Windows Fonts 目录。

macOS：

- 使用 Core Text session scope 注册和注销。
- 注册前读取 descriptor/PostScript name 并执行冲突检查。
- 只注销本 Agent 当前会话确认注册成功的 URL。

完成后删除 Electron Main 中现有的 PowerShell、osascript 直调逻辑和内存 `activeFaces` 状态，Main 只保留协调职责。

交付物：Windows/macOS 可供第三方软件使用、可可靠回收的正式激活实现。

### 2.6 完成 Linux 隔离启动模式

- 在 `$XDG_RUNTIME_DIR` 创建会话字体目录和临时 Fontconfig 配置。
- 通过 `FONTCONFIG_FILE` / `FONTCONFIG_PATH` 启动目标软件。
- 跟踪目标进程，退出后清理 runtime 文件。
- 将现有用户字体目录软链加 `fc-cache` 的方式标记为“桌面会话模式（实验性）”。
- 桌面会话模式清理前必须校验应用目录、file ID 和哈希。
- UI 明确说明该模式不能保证已运行应用立即刷新字体。

交付物：Linux 推荐模式可用，实验模式能力边界清晰。

### 2.7 恢复 Renderer sandbox

- 调整 preload 构建产物为 sandbox 可加载的格式，或升级并修正 electron-vite 配置。
- 将 BrowserWindow 改回 `sandbox: true`。
- 验证 preload 仍只暴露显式、类型化 API。
- 回归自定义协议、字体查询、标签编辑和激活 IPC。

该项与 Activation Agent 可并行开发，但属于本阶段退出条件，不能推迟到发布阶段。

交付物：Electron 安全基线重新完整达标。

### 2.8 建立本阶段自动化测试

最低测试范围：

- Vitest：状态机、引用计数、冲突判定、journal 恢复、migration。
- Agent 集成测试：握手失败、令牌错误、命令超时、Main PID 消失、重复清理幂等。
- 平台集成测试：激活、停用、`already_available`、同 PostScript name 冲突。
- Playwright Electron：激活状态展示、失败原因、退出前清理流程。
- 手工平台验收：在 Photoshop 或同类第三方软件中验证激活和停用。

交付物：仓库级 `test` 脚本，以及 CI/本机均可执行的核心测试集。

## 3. 建议拆分的里程碑

### M1：协议和数据层

- 激活契约、状态机和错误码完成。
- migration 机制及两张激活表完成。
- fake adapter 单元测试通过。

### M2：Agent 生命周期

- activation-client 与独立 Agent 完成。
- 安全 IPC、PID 监控、原子 journal 和启动恢复完成。
- 强杀 Main 后 fake adapter 能自动清理。

### M3：平台可靠激活

- Windows/macOS 正式适配器完成。
- 系统字体查询、冲突阻止和引用计数完成。
- Electron Main 中旧激活实现移除。

### M4：阶段收尾

- Linux 隔离启动模式完成。
- Renderer sandbox 开启。
- 自动化测试和第三方软件验收通过。

## 4. 阶段验收清单

- 激活字体后，目标第三方软件可以使用该字体。
- 停用后，第三方软件不能继续新建使用该字体。
- 系统已安装同一字体时返回 `already_available`，退出后原字体仍存在。
- 相同 PostScript name、不同版本或哈希时默认阻止并提示冲突。
- 正常退出时等待全部激活记录清理完成。
- 强杀或模拟 Main 崩溃后，Agent 在数秒内开始回收。
- Agent 重启和应用下次启动时可以恢复未完成清理。
- 重复执行清理不会误卸载字体，也不会产生负引用计数。
- TTC/OTC 的所有权按文件记录，界面行为与记录一致。
- Linux 隔离模式退出后不残留 runtime 字体文件。
- Renderer 运行于 sandbox，现有核心功能无回归。
- 数据库升级后现有索引、标签、收藏和备注不丢失。

## 5. 当前阶段暂不做

以下内容不应阻塞 Phase 3，可进入下一阶段或独立排期：

- 自动更新、Windows/macOS 签名、公证和三平台安装包。
- 完整的 50K 字体性能基准和损坏字体 fuzz 数据集。
- 可变字体 axis 调节 UI。
- TTC/OTC 应用内预览子集 fallback。
- 按 SHA-256 聚合重复字体的 UI。
- i18n 和大组件全面拆分。

但以下两项建议在 Phase 3 稳定后、进入发布工作前优先处理：

- 将字体详情解析从 Electron Main 同步路径迁移到 worker 或 utility process。
- 将 Renderer 全量 hydrate 改为按虚拟窗口懒加载，确保 50K+ face 的数据层也保持分页。

## 6. 立即可执行的下一步

1. 定稿激活状态机、Agent 消息协议和错误码。
2. 建立 migration 目录并新增 `activation_session`、`activation_record`。
3. 用 fake adapter 实现 Activation Agent、activation-client、PID 监控和 journal。
4. 为异常退出回收写第一组自动化集成测试。
5. fake adapter 验收通过后，再分别接入 Windows 和 macOS API。

在第 4 步通过之前，不继续扩展现有 Electron Main 内的激活 spike。
