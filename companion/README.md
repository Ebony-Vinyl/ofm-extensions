# OFM 社区桥

独立启动的可信本机程序，为 OFM 沙箱扩展提供网页渠道与本地增强。它有本机文件、子进程和网络权限，安装/登录须显式执行；不属于沙箱内扩展。

完整安装、账号、项目授权、检索和验收说明见 [社区适配文档](../docs/community-adapters.md)。

- `install.mjs`：按 `plugins.lock.json` 安装固定提交，创建私有配置。
- `install-compression.mjs`：用本仓库实现替换压缩依赖的 RTK 目录；不修改其他策略或账号配置。
- `cli.mjs`：登录、列模型、额度、搜索、取回折叠原文。
- `server.mjs`：仅监听 `127.0.0.1:19281`，带密钥访问，透传 SSE。
- `runtime.mjs`：上游 provider 入口、登录、模型与续期适配。
- `services.mjs`：搜索、历史、纯压缩管线与持久归档。

不在本目录保存真实配置、token、账号、node_modules 或历史记录；这些应放到用户选择的独立私有目录。

旧社区桥升级压缩实现：先停止社区桥，执行 `node companion/install-compression.mjs /绝对路径/config.json`，然后重新启动。新安装会自动执行这一步。原依赖的许可文件继续保留；当前替换仍需完整兼容验收，不能把目录替换成功当作全部功能通过。
