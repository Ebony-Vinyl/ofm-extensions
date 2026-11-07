# 社区来源与许可

本批适配由 OFM Extensions 维护者维护，不代表上游作者维护 OFM 宿主集成。新增包自身采用 MIT；网页、搜索、历史和压缩在独立社区桥中加载上游原文件，安装后保留上游原 LICENSE/NOTICE，不打包到沙箱中。

| 对应能力 | 来源与核对提交 | 本次处理 |
| --- | --- | --- |
| AMD Cloud | [aqiu817/magpie-amd-cloud](https://github.com/aqiu817/magpie-amd-cloud/tree/feb76d9136a74e01b418b7f61f2668b623b6c922) | API 与模型目录契约适配；MIT，Copyright (c) 2026 aqiu817；许可保留在包目录和运行入口 |
| DeepAI Code | [aqiu817/magpie-deepaicode](https://github.com/aqiu817/magpie-deepaicode/tree/e18c6b3bf95a0d79638fd9848da33518dacfa97f) | API key、设备标识、动态模型与 wire 适配；MIT，Copyright (c) 2026 aqiu817；许可保留在包目录和运行入口 |
| DeepSeek Web | [volcanicll/magpie-deepseek-web-auth](https://github.com/volcanicll/magpie-deepseek-web-auth/tree/e360be09485d603f338517af15015324b0ed0d2f) | 固定源码加载；原登录、PoW、附件与 SSE 实现；MIT |
| Gemini / AI Studio | [BUKOWSKIREAL/magpie-gemini-web](https://github.com/BUKOWSKIREAL/magpie-gemini-web/tree/c3402bc457b2eb617cc47e09d09ec7bbda3bc02e) | 固定源码加载；原登录/本地后端；拆为两个 OFM 渠道；MIT |
| Muse Web | [JohnWangggg/magpie-muse-web](https://github.com/JohnWangggg/magpie-muse-web/tree/4a78fdbcd546d497a75d7b92630418fd1248dcc3) | 固定源码加载；原引擎、登录、续期；MIT |
| 历史召回 | [vshulcz/deja-vu](https://github.com/vshulcz/deja-vu/tree/ae84bb47b367b41672bfbeeab41b5d3618483a00) | 使用项目作用域的 Magpie hook，deja 二进制/索引需另行配置；MIT |
| 搜索 | [guotree/magpie-websearch](https://github.com/guotree/magpie-websearch/tree/21116a7ba3328bc023ba30d9923d0b1480deaea3) | 使用搜索执行接口，在 OFM 中提供显式请求增强；MIT |
| 压缩 | [manjughosa/magpie-compress-core](https://github.com/manjughosa/magpie-compress-core/tree/630e2d512b1e2e5a063562f664dbf6e2accfb103) | 使用纯 pipeline；沿用上游 MIT、NOTICE、PROVENANCE 和 Apache-2.0 引擎许可；不移植原管理页面或遥测 |
| 输出清理、可逆折叠 | 本仓库实现 | 三协议工具结果清理、按项目/会话持久归档与 CLI 检索；MIT |

上游固定提交由 `companion/plugins.lock.json` 记录。升级须修改 pin 并重新执行兼容与集成检查；不会运行时跟随分支 HEAD。固定 Git 提交不等于固定所有传递依赖：首次安装由 Bun 解析上游依赖并在用户的私有目录生成 bun.lock。上游另行安装的浏览器后端依其自身版本/校验规则管理。

此适配不包含上游管理页面、原生搜索/检索工具注册、完整 Magpie 账号管理 UI 或实时后台监测；本批沿用 v1 渠道/增强契约，未迁移到 2.8.2 的 v2 页面能力。具体操作和未验证范围见 [安装说明](../community-adapters.md)。
