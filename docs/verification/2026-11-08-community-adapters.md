# 社区扩展整批验证记录

目标仓库：`Ebony-Vinyl/ofm-extensions`。分支：`zixin/community-adapters`。

范围：6 个渠道、5 个增强、本机社区桥、固定源码来源、注册表和使用文档。没有修改 `dsh-our-free-model` 实现代码；该检出只快进到上游提交，用作兼容检查。

## 环境

- macOS arm64；Node.js 24.8.0；临时目录中的 Bun 1.4.4。
- 宿主：OFM 2.8.2，`214c5111e852170137fe84dd1ea2c8f352300350`。
- 扩展仓库 base：`4e7ba2e`。
- 固定上游版本：`companion/plugins.lock.json`，另有 AMD / DeepAI API 来源记录。
- 全部账号、数据目录及 HTTP 内容均为临时合成夹具；未读取真实历史索引、未登录真实账号、未调用真实模型生成。

## 已执行与结果

| 检查 | 结果 |
| --- | --- |
| `node --experimental-vm-modules --test tests/community.test.mjs tests/runtime.test.mjs` | 34/34 通过 |
| `node scripts/validate.mjs` | 17 个包通过清单、权限和源码扫描；包括原有 6 个包 |
| `node companion/install.mjs <全新私有临时目录>`，以 OFM_BUN 指向临时 Bun | 6 个固定 Git 源安装成功；包括依赖共 8 个包，生成 0600 配置 |
| `bun tests/upstream-smoke.mjs <临时社区桥配置>` | 通过：四个网页插件真实入口/登录方法、21 个搜索钩子、实际历史 CLI hook、三协议压缩；全部 fetch 被拦截 |
| `node tests/host-integration.mjs <本机 OFM 检出> <临时社区桥配置>` | 通过：11 个新增包被真实宿主加载；6 个渠道 Worker；4 个网页渠道目录/请求/本地流；5 个增强的三协议及组合执行 |
| `node scripts/build-registry.mjs` | 17 个包，32965 字节，摘要与清单同步 |
| `git diff --cached --check` | 通过 |
| `node scripts/validate.mjs --check` | **未通过**：唯一错误是新注册表未重新签名；未修改 registry.sig 或公钥 |

上表路径参数以描述代替个人绝对路径；安装时使用本机已启用的代理环境下载依赖。包内运行不改变代理配置。

## 回归重点

- AMD 目录过滤、去重、不伪造未知上下文；DeepAI 实际设备标识、Responses wire、会话亲和。
- 4 个沙箱网页渠道到本地桥的对应关系、凭据、工具和会话透传。
- SSE 先收到首块再结束、Retry-After/HTTP 状态、断开取消。
- 原上游 API 登录回调、动态账号选择、输入 key 保存、并发续期去重并持久化。
- 上游并发上限覆盖整个流，排队取消不发送请求。
- 三种 wire 的工具 ID、图片、签名块和调用者原始 body 保持；OSC 控制符之间的诊断行不被吞掉。
- 历史的 local 来源与 Anthropic 协议映射、授权项目、子进程 payload；搜索显式触发且外部结果标记为不可信参考。
- 折叠首次原样、相同请求重试原样、后续折叠、原文准确取回、跨项目/会话隔离。
- 真实 OFM Worker/RPC 下，搜索、历史、清理、压缩和折叠组合运行。

## 未完成的验收

维护者对新注册表的生产签名、远端 CI；真实渠道账号的浏览器登录、额度/地区限制与真实生成；DSH Desktop 界面；Windows / Linux 网页后端。上述均不因本地夹具通过而视为完成。

本机真实 DSH/Codex 的安装、配置、插件和进程均未改动。新增代码提交到扩展仓库，不发布宿主版本。
