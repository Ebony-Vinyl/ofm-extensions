# OFM 原生渠道迁移

范围固定为原始市场快照 44 个渠道排除 19、30、35 后的 41 项，见 `scope.json`。只迁移模型与账号认证；中间件、工具、Agent 和页面不在本轮范围。

执行链路：OFM 扩展沙箱 → OFM 宿主 HTTP/流处理 → 厂商。凭据保存在 OFM 私有账号库，通过 `ctx.auth.get()/set()` 使用；续期走宿主 `ctx.auth.refresh()` / `refreshAuth`，不是在模型 hook 中越权写凭据。没有 Magpie 二进制、companion、独立网关、CLI 运行时或默认回退。参考源码只读，不加载或执行。

## 实际落地：12 包，本轮新增 8 包

| 包 | 认证与协议 | 状态与缺口 |
| --- | --- | --- |
| `native-river` | 本人 API Key、动态目录、Chat / Responses | 原生代码完成，只有合成验证；无厂商用量查询 |
| `native-cloudflare` | Token + Account ID、分页文本目录、Chat | 原生代码完成，只有合成验证；无真实计划权限验收 |
| `native-agnes` | 本人 API Key、实时目录、Chat | partial；浏览器登录、发钥与续期未迁移 |
| `native-copilot` | 本人获授权 OAuth App、设备码、宿主令牌续期、三协议 | partial；不再借用官方 App ID / VSCode 身份头，普通 OAuth App 不保证获 Copilot 权限；Enterprise 未支持 |
| `native-cline`（新增） | 本人正式 API Key、账号校验、云模型目录、Chat | partial；拒绝 cline-free/stealth 客户端专享路由，不冒用 CLI；WorkOS 登录未迁移 |
| `native-opendesign`（新增） | 本人 runtime key、目录、Chat / Responses / Messages | partial；拒绝 control key；不伪装 Vela CLI，设备登录和控制面未迁移 |
| `native-agnes-code`（新增） | 本人已有 accessToken、目录、Chat | partial；无登录/自动续期，不读取或解密桌面会话 |
| `native-sensenova`（新增） | 正式本人 Token Plan key、目录、Chat | partial；过滤 image-only/来源标明的非计划条目；不复制浏览器指纹或自动发钥 |
| `native-inkstone`（新增） | 本人 TOKENPLAN_API_KEY、目录、Chat | partial；无网页登录/墨点/发钥、图片预检和特有错误翻译 |
| `native-commandcode`（新增） | 本人非 Go Provider API key、实时目录、三协议 | partial；不支持 Go /alpha/generate、SystemOne 或 CLI 登录 |
| `native-astudio`（新增） | 本人已有 modelBearerToken、目录、Responses | partial；不复制 clientType 身份，不读取桌面/注册表；登录/发钥/续期未迁移 |
| `native-deepai-code`（新增） | 本人 Key + 本人真实设备 SHA-256、动态目录、Chat / Responses | partial；/models 是公开接口，验钥使用 /theos，可能触发当日设备额度；无回环登录/桌面读取，不生成/派生/轮换设备指纹 |

API-only 不等于完整渠道登录迁移，短期会话令牌也不承诺自动续期。模型出现不保证账号有权调用，厂商权限、费用和限制照常生效。配套 OFM 宿主已提供请求级有界账号切换：仅同扩展、已启用且账号目录精确支持同模型/协议的账号，输出前明确认证/额度/限流失败才允许切换，最多三个账号；输出后不重放，不更改所选账号。生产真实登录、生成、签名发布、GUI 仍未验收。

其余 29 项（20 pending、9 blocked）逐项记录原因，不生成市场占位包。特别是：

- Nous：参考包是 inference JWT + device OAuth，README 明确 `hermes-cli` 第三方授权未获确认。没有找到可核实的正式长期 API Key 路径，保持 `pending-native-authorization`，不冒用 Hermes Client ID 或把短期 JWT 包装成长期 Key。
- OpenCode Zen Free：来源明确为消除 FreeTierError/FreeUsageLimitError 复制客户端 UA、项目和核心工具，标 blocked，不绕过免费访问限制。
- agy-cli：来源通过 agy ACP/本地 shim 执行 CLI，与本轮纯 OFM 原生链路冲突，标 `blocked-cli-conflict`。
- AWS Bedrock SSO、Providers Hub、Codar：外部源码不在给定快照，保持 pending-source-unavailable，不能按 registry 摘要算完成。

来源、逐包认证/端点和缺口见 `sources.json`；MIT 许可与实际版权人保留在每包 `main.mjs` 开头，因为宿主仅下载这一入口。DeepAI 同时保留原 NOTICE 的协议来源与非官方声明。

## 配套宿主接口

要求 `minHost: 2.8.2` 与 `requires: ["native-auth"]`，`permissions.secrets: ["account"]`，固定 HTTPS origin。`native-auth` 当前仅在配套开发工作树中验证，尚未随普通 2.8.2 发布；版本号满足不代表具备该能力。此批 PR 不包含宿主修改，部署前必须先交付配套宿主。旧宿主不应启动缺失 capability 的扩展。

本次批量提交 12 包及公共契约，是经本次任务明确确认的单包 PR 规则例外，不改变后续贡献默认规则。`native-deepai-code` 与已有 `deepai-code` 使用同一厂商端点，区别是认证由 OFM 私有账号库及动态登录表单管理，不再使用普通 `ctx.secrets` 配置；两包并存，不自动迁移或复制旧凭据。

`authMethods()` 返回 `{id,type,label,fields:[{key,label,type:"text"|"password",required}]}`。`authorize` 必须显式传 `inputs.methodId`（Key 为 `api`；Copilot 为 `github-device`）。未知/缺失 methodId 不发请求、不保存凭据。Key 输入为 `inputs.key`；Cloudflare 另需 `inputs.accountId`，DeepAI 另需 `inputs.machineFingerprint`，Copilot 另需 `inputs.clientId`。

宿主管理 API：DSH `POST /api/our-free-model/extensions/auth`，独立端 `POST /api/management/plugins/auth`，使用各自现有管理鉴权。宿主顶层 `accountId` 是 OFM 私有账号槽，与 Cloudflare 表单中的厂商 Account ID 不同。管理 action 与账号启停/选择以配套宿主实现为准；设备 poll 只传公开 `flowId`，不传设备密钥。

API credential validation 只请求来源中有依据的账号或目录端点，不发送生成。失败响应、格式异常、缺字段和网络失败都不会覆盖已有凭据。请求 body 交给宿主按 wire 构造；包只提供固定端点和认证头，不把密钥写入生成 body。

## 验证

扩展仓库验证命令：

```sh
node scripts/validate.mjs
node --experimental-vm-modules --test tests/community.test.mjs tests/runtime.test.mjs tests/native-providers.test.mjs
```

新增可选真实宿主 Worker 合成集成测试：

```sh
OFM_NATIVE_HOST_ROOT=/absolute/path/to/native-auth-host node --experimental-vm-modules --test tests/native-host.test.mjs
```

这项只在临时夹具副本中替换厂商地址到本地测试服务，生产包 HTTPS 权限不变；验证 12 个包的表单、认证、模型、Chat/Responses/Messages body、账号切换/注销及公开返回不含凭据，不读取真实账号、不访问外网生成。未设置宿主路径时明确 skip，不把 skip 算通过。

本轮测试结果以执行报告为准。`validate --check` 同时检查索引一致性与签名。当前 registry 已重建并与 29 包源码匹配，但 `validate --check` 明确失败于生产签名不匹配；未重签、不替换生产公钥、不绕过验签，因此仍不能发布。
