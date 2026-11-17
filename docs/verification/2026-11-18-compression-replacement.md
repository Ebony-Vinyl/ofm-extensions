# 社区桥 RTK 替换验证

本次改动影响范围是社区桥压缩引擎、安装迁移与 CI 模块。

新实现位于 `companion/compression/`。新安装在固定上游依赖下载后替换 `engines/rtk/`；旧安装通过 `install-compression.mjs config.json` 显式迁移。入口保持 `id`、`apply`、`configSchema`，其他压缩策略继续由原固定管线提供。

## 已完成

- 从已核对的 origin/main 单独建立 rewrite/community-compression，仅携带本次压缩提交：全部本地测试 59 通过、0 跳过。此前在含额外原生渠道的分支检查为 98 通过、1 跳过，不能混用为本分支计数。
- 指定原生认证宿主工作区后，原生账号 Worker 测试通过，0 跳过；使用合成上游及临时数据，不代表真实账号登录。
- 对固定提交 `630e2d512b1e2e5a063562f664dbf6e2accfb103` 的独立副本执行新旧对照：176 组配置/输入的 body、changed flag、状态记录一致，安装后的实际 pipeline 调用通过。
- 替换后的隔离副本执行原上游 `test/rtk.test.mjs`：25 项行为检查通过，包含实际 middleware。
- 补齐配置元数据导出后，安装/配置针对性检查通过；重复安装及拒绝无关包/不匹配版本的路径均验证。故障注入验证切换失败恢复旧字节，恢复失败保留恢复副本。
- 最近一次交替顺序基准：一万行重复日志，旧引擎中位耗时 24.42ms、新引擎 15.24ms，下降约 37.6%。仅代表该合成负载。
- `git diff --check` 通过。

## 未完成与发布限制

- `node scripts/validate.mjs --check` 在独立分支通过：17 个包、注册表同步及签名均验证成功。本次不修改 registry.json/registry.sig。此前原生渠道分支的签名失败不影响该独立分支。
- 尚未发布、提交 PR、迁移用户实际安装，也未完成 Windows 或真实 Desktop/账号验收。
- 本实现参考了原行为、规则与源码，不属于 clean-room；代码改写和测试通过不构成独立的许可证结论。依赖的 LICENSE/NOTICE 保留，其他 Apache 引擎仍在使用。
- 版本检查位于安装配置读取这一信任边界，避免把仅对固定版本验收的替换应用到任意目录或其他版本。
- 安装切换发生异常时尝试恢复旧目录；若恢复失败则保留恢复副本，不主动删除它。

## 重跑

```bash
node --experimental-vm-modules --test tests/*.test.mjs
node tests/compression-parity.mjs /absolute/path/to/pinned-compress-core
node scripts/validate.mjs --check
git diff --check
```

对照用的旧源码放在仓库外临时目录，不加入本仓库或发布产物。
