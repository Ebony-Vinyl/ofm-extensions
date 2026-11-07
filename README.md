# OFM Extensions

**Our Free Model 扩展市场** — 一个由 Ed25519 签名、CI 把关的扩展仓库，为 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 插件提供渠道（channel）与增强（enhancement）模块。

- [English](README_EN.md)

## 工作原理

宿主插件的扩展运行时从这里拉取 `registry.json`：

1. **先验签** — 注册表整体由维护者的 Ed25519 私钥签名（`registry.sig`，对排序规范化后的 JSON 计算）；客户端用内置公钥验签，验不过就一个条目都不读。
2. **再下载** — 每个条目内联携带清单和 `main.mjs` 的字节数与 sha256；代码只从本仓库自己的镜像地址下载，大小或摘要不符即拒绝安装。
3. **静态扫描** — 安装前重跑与 CI 相同的扫描：只允许 `ofm:sdk` 一个导入，禁命名 `require` / `process` / `eval` 等受限 API，拒绝压缩包与超长行。
4. **沙箱运行** — 扩展在 `vm.SourceTextModule` 沙箱里加载，唯一的导入是桥接的 `ofm:sdk`；出站 HTTP 按清单声明的 origin 逐次放行，密钥、存储、日志全部走 JSON 桥。

"用户上传" 意味着 "用户开 PR"——和任何被策展的市场一样，签名加人工评审。

## 当前收录

| 包 | 类型 | 标签 | 说明 |
| --- | --- | --- | --- |
| [`kilo-free`](packages/kilo-free/) | channel | free · gateway · kilo · no-key | Kilo 网关免费档，免密钥，接管内置 Kilo 车道（11 个模型） |
| [`openai-compatible`](packages/openai-compatible/) | channel | chat · compatible · openai · self-hosted | 任意 OpenAI 兼容 `/chat/completions` 服务（OpenAI、Ollama、LM Studio、llama.cpp、vLLM、回环代理） |
| [`anthropic-compatible`](packages/anthropic-compatible/) | channel | anthropic · claude · messages · self-hosted | 任意 Anthropic 兼容 `/v1/messages` 服务，走 messages 线 |
| [`param-override`](packages/param-override/) | enhancement | body · parameters · rewrite | 限制出站 `max_tokens`，可选丢弃 `temperature` |
| [`system-prompt`](packages/system-prompt/) | enhancement | prompt · rewrite · system | 给每轮请求前置一条系统提示，三种 wire 各有正确形状 |
| [`model-filter`](packages/model-filter/) | enhancement | catalog · filter · models | 按子串隐藏目录模型（`onModels` 为保留钩子） |

## 安装

在 dsh-our-free-model 的设置页打开 Extensions（扩展）市场页，选择安装即可；渠道安装后即启用，增强默认停用、需手动开启。宿主版本要求 ≥ **2.8.1**。

市场页支持：搜索（名称 / id / 摘要 / 标签）、类型筛选（渠道 / 增强）、排序（索引顺序 / 最新发布 / 名称）、已安装页的待更新计数与「全部更新」；`/` 键直接聚焦搜索框。

宿主每隔数小时自动刷新一次注册表（TTL 缓存 + 后台定时刷新），上游的新版本不需要用户打开市场就能出现在「已安装」页；所有镜像都不可达时，宿主会退回构建时内置的签名货架快照，保证首次安装也有内容可看。

## 文档

- [扩展格式](docs/extension-format.md) — 清单字段、注册表元数据、扫描规则
- [渠道 API](docs/channel-api.md) — `listModels` / `prepareChat`、ctx 桥、三种 wire
- [增强 API](docs/enhancement-api.md) — `onRequest` / `onModels` / `onUsage`、fail-open 语义
- [安全模型](docs/security.md) — 签名方案、钉扎公钥、威胁边界
- [发布流程](docs/publishing.md) — 构建、签名、CI、密钥保管

## 参与贡献

欢迎 PR——见 [CONTRIBUTING.md](CONTRIBUTING.md)。最快的起点是模板脚手架：

```bash
node scripts/new-package.mjs my-channel --author "Your Name"
```

它会从 [template/](template/) 复制一份可运行的骨架到 `packages/<id>/` 并立刻跑一遍
与 CI 相同的校验。CI 会跑完整的闸门（`node scripts/validate.mjs --check`）；合并到
main 后 `sign.yml` 自动重建并重签注册表。

## 许可

[MIT](LICENSE)
