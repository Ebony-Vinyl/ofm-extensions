# 社区扩展适配与安装

本批增加 6 个渠道和 5 个增强，覆盖约定的九类能力。两个直接 API 渠道与轻量清理在扩展沙箱内运行；网页渠道、压缩、历史和搜索通过显式启动的本机社区桥运行固定版本上游代码。

## 安装前提与当前状态

扩展依照本仓库的 `minHost: 2.8.1` 契约实现。2026-11-08 已拉取 `dsh-our-free-model/origin/main` 的 `214c5111e852170137fe84dd1ea2c8f352300350`（2.8.2），并使用其中真实 `createExtensionRuntime` 完成隔离数据目录下的 Worker、配置、secrets、四个网页渠道请求与五个增强的三协议/组合验证。

**真实宿主内核兼容检查已通过；真实账号登录、额度和生成、运行中的 DSH Desktop UI 尚未验收。** 渠道网络响应使用合成数据，历史索引使用临时 CLI 夹具，没有注入或重启本机 DSH。

新增包进入市场还需要维护者签署重建后的注册表。现有签名不可复用到新内容，不应关闭验签。

## 新增能力

| 扩展 | 类型 | 配置与适配范围 |
| --- | --- | --- |
| `amd-cloud` | 渠道 | `apiKey`；读取 AMD Radeon Cloud 动态目录，过滤非文本输出；标准 Chat 请求 |
| `deepai-code` | 渠道 | `apiKey`、本人设备的 `machineFingerprint`；动态目录、Chat/Responses、会话亲和头；不自动读取桌面客户端凭据 |
| `deepseek-web` | 渠道 | `bridgeToken`；原上游浏览器/粘贴登录、PoW、附件及流转换由本机桥加载上游实现 |
| `gemini-web` | 渠道 | `bridgeToken`；原上游本机 Gemini 后端或已有后端，登录与账号选择由 CLI 完成 |
| `ai-studio` | 渠道 | `bridgeToken`；原上游 AI Studio 浏览器后端和登录 |
| `muse-web` | 渠道 | `bridgeToken`；原上游 Muse 引擎、浏览器登录或已有引擎账号 ID |
| `output-cleaner` | 增强 | 无密钥或网络；清理工具结果的 ANSI 和相邻重复进度行，支持三种 wire |
| `context-compression` | 增强 | `bridgeToken`；调用 compress-core 纯压缩管线，默认保护系统提示与最近一轮 |
| `history-recall` | 增强 | `bridgeToken`、授权 `project`；deja-vu 只按指定项目召回，支持三种 wire |
| `context-folding` | 增强 | `bridgeToken`、授权 `project`；显式标记片段的本地持久归档和延后折叠 |
| `web-search` | 增强 | `bridgeToken`；当前用户消息以 `[search]` 开头时，调用所选搜索通道并追加参考 |

所有增强安装后默认关闭；逐项开启即可，不要求全部开启。上游网页平台的账号、地区、额度限制继续生效，不保证免费或无限量。来源、固定提交与许可见 [上游记录](upstream/README.md)。

## 本机社区桥

需要 Node.js 22+、Bun，以及所选上游登录后端要求的浏览器/系统依赖。Windows 的路径和各网页后端未实测。下面从仓库根目录执行；把私有目录换成自己选择的绝对路径。

```bash
node companion/install.mjs /absolute/private/ofm-community
```

安装器使用 Bun 下载 `companion/plugins.lock.json` 固定提交及其依赖，关闭包安装脚本，不覆盖已有 `config.json`。若 Bun 不在 PATH，可用 `OFM_BUN=/absolute/path/to/bun` 指定。用户明确执行登录后，上游网页插件可能另外安装、启动自己的浏览器后端；它们以当前用户权限运行，不受扩展沙箱约束。

配置文件包含随机桥密钥和登录凭据，以 0600 写入。请只在本机编辑，不提交或发送文件全文。在每个需要社区桥的扩展 secrets 中保存同一个 `token` 值为 `bridgeToken`。扩展的网络权限仅允许 `http://127.0.0.1:19281`；账号凭据保留在社区桥配置，扩展只持有桥密钥。

列出某渠道的登录方法，然后用返回的数字选择：

```bash
bun companion/cli.mjs login /absolute/private/ofm-community/config.json deepseek-web
bun companion/cli.mjs login /absolute/private/ofm-community/config.json deepseek-web 0
```

其他渠道 ID 是 `gemini-web`、`ai-studio`、`muse-web`。CLI 支持上游动态账号问题、手工浏览器授权、粘贴授权码及 API key。登录动作必须由用户显式执行，安装扩展不会读取浏览器登录态。DeepSeek 选择浏览器方式时会按上游实现读取用户指定/已有浏览器的会话令牌。

```bash
bun companion/cli.mjs models /absolute/private/ofm-community/config.json gemini-web
bun companion/cli.mjs usage /absolute/private/ofm-community/config.json muse-web
bun companion/server.mjs /absolute/private/ofm-community/config.json
```

服务只监听 `127.0.0.1:19281`，要求每个请求携带桥密钥。聊天遵守上游声明的并发上限（整个流占用名额），以背压透传 SSE，客户端取消时中止上游，保留 HTTP 状态和 Retry-After。启动后变更账号或配置需要重启社区桥；运行中上游提供的到期续期回调会合并并保存新凭据。额度 CLI 只在上游提供结构化读取接口时有效，未接入 OFM 的账号卡片 UI。

## 历史召回

在私有配置中明确授权项目代号，例如：

```json
{
  "projects": { "my-project": "/absolute/path/to/project" },
  "history": {
    "root": "./node_modules/ofm-source-history",
    "options": { "bin": "/absolute/path/to/deja", "requestTimeoutMs": 800 }
  }
}
```

这是配置片段，需合并到安装器已有配置，保留 token/providers。安装 deja-vu 的 JS hook 不代表已经安装本机 `deja` 可执行文件或建立索引；需按 [deja-vu 上游文档](https://github.com/vshulcz/deja-vu) 单独完成。扩展配置 `project=my-project`，不允许请求任意指定目录。适配器强制禁止 remote/unscoped 召回。匹配的旧对话会发送给本轮选用的模型，作为标记过的不可信参考；启用前确认该项目允许这样使用。

社区桥增强限时 1600ms，宿主契约限时 2s；搜索/历史超时或桥未启动时保持原请求。慢搜索不应阻止正常聊天；可以使用 CLI 单独查询：

```bash
bun companion/cli.mjs search /absolute/private/ofm-community/config.json 搜索词
```

## 搜索

扩展只处理 `[search] 搜索词`，不会自动外发普通聊天。默认 `search.provider=anysearch`，可在私有配置切换到上游注册的 21 种通道之一；需要密钥的通道设置 `search.key`。提供商选项原样放到 `search.options`，采用上游键名。此次未实现模型主动调用的原生 search tool 注册，SDK 只提供请求增强；结果附在当前用户消息的 `<ofm-search untrusted="true">` 中。

## 压缩与清理

`output-cleaner` 只整理工具输出，不截断普通用户消息或删除图片/工具 ID。

`context-compression` 在桥内调用固定版本的 `pipeline.js`，默认使用上游的 Lite、RTK、Codex Responses、Headroom、Read Lifecycle 策略。压缩可能改变历史文本，默认保留 system 和最近一轮；更激进策略需用户在 `compression.options.strategies` 手动启用。不同策略对协议/文本形状的支持以原上游实现为准，不承诺每条消息都缩短。

默认请求上限 512000 字节（`compression.options.maxBytes`），策略间预算 50ms。直接调用纯管线，不调用上游遥测、原文采集或统计页面钩子；强制关闭 `llm`、`session-dedup` 和 `ccr`，避免后台模型调用和没有检索存储的标记。需要可逆折叠时启用下述独立扩展。

## 可逆上下文折叠

只处理 assistant 纯文本或文本块中明确成对的标记，跳过携带 tool_calls 的消息：

```text
<!-- @context-fold begin notes -->
这里是至少 512 字符、希望归档的原文。
<!-- @context-fold end notes -->
```

第一次出现先原样发送并保存；相同请求重试仍原样发送；在后续不同请求中再次出现时，确认归档可读后替换成 `[[ofm-fold:sha256]]`。项目与 `meta.sessionId` 都不能为空。归档按项目/会话隔离，每片段最多 256KiB、每个作用域最多 10MiB；满额时不折叠，不自动删除仍被引用的原文。

检索原文：

```bash
bun companion/cli.mjs unfold /absolute/private/ofm-community/config.json my-project SESSION SHA256
```

SDK 无注册工具能力，因此这不是原生模型检索工具。使用者需自行允许 agent 执行上述 CLI，或人工取回原文；无法提供检索路径时应保持此增强关闭。关闭扩展不影响已存原文，不要在仍有占位符的会话中删除归档。

## 验证与发布边界

```bash
node --experimental-vm-modules --test tests/community.test.mjs tests/runtime.test.mjs
node scripts/validate.mjs
# 先按上文安装固定上游，以下测试拦截全部 fetch，使用临时合成数据：
bun tests/upstream-smoke.mjs /absolute/private/ofm-community/config.json
# 另行检出 OFM 宿主；测试只使用临时数据，不操作正在运行的 Desktop：
node tests/host-integration.mjs /absolute/path/to/dsh-our-free-model /absolute/private/ofm-community/config.json
node scripts/build-registry.mjs
node scripts/validate.mjs --check
```

前两项覆盖沙箱加载、模型/请求契约、SSE/断开取消、私有归档、登录与续期；上游集成检查覆盖四个网页入口、21 个搜索钩子、真实历史子进程钩子与三种 wire 的实际压缩。另有真实 OFM 2.8.2 内核的 Worker/RPC、四渠道与五增强组合验证。没有调用真实账号生成或完成浏览器登录。

最后一项还需要新注册表的有效维护者签名。构建成功不等于验签通过；只有签名和宿主验收完成后才能声称已在市场可用。生产密钥不可用于本地合成测试，公钥不可替换为测试密钥。

## 停用与回退

在宿主关闭新增增强/渠道，停止社区桥进程即可回退。既有六个扩展不受影响。保留私有配置和 archive 以便恢复账号与折叠原文；确认无会话引用后再人工删除私有目录。无需卸载或重启 DSH/Codex，也没有自动启动项。
