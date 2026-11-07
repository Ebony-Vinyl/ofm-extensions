# 包模板（template/）

这是新扩展的起点：复制本目录到 `packages/<id>/`，改名、填实现，然后本地校验。

最快的路径是脚手架命令（在仓库根目录运行）：

```bash
node scripts/new-package.mjs my-channel          # 渠道模板
node scripts/new-package.mjs my-enhancement --type enhancement
```

它会复制模板、替换占位 id、写入当天为 `publishedAt`，并立刻跑一遍与 CI 相同的
校验（`node scripts/validate.mjs --check`）。

## 手动路径

1. 复制 `template/` 到 `packages/<你的id>/`（id 必须匹配 `/^[a-z][a-z0-9-]{1,47}$/`）。
2. 编辑 `ofm-plugin.json`：id、version、name、description、author、license、
   permissions（网络 origin 白名单与密钥名）、models、config、summary、tags、
   publishedAt。字段含义见 [docs/extension-format.md](../docs/extension-format.md)。
3. 编辑 `main.mjs`：实现 `prepareChat`（渠道必需）或 `onRequest`（增强必需）。
   API 见 [docs/channel-api.md](../docs/channel-api.md) 或
   [docs/enhancement-api.md](../docs/enhancement-api.md)。
4. 本地自检：

   ```bash
   node scripts/validate.mjs            # 校验全部包
   node scripts/build-registry.mjs      # 重建 registry.json
   node scripts/sign-registry.mjs       # 维护者签名（需要私钥）
   ```

5. 开 PR。CI 会跑完整的闸门；合并后 `sign.yml` 自动重建并重签注册表。

## 注意

- `summary` 是市场卡片上的一句话（≤300 字符）；`description` 是详情弹层里的长说明。
- `tags` 会作为可搜索的标签出现在市场筛选里（≤8 个，按字母序存储）。
- `main.mjs` 不允许压缩或打包：CI 与宿主都会拒绝超过 3 行的 500+ 字符长行。
- 渠道包如果声明了 `"replaces": "kilo"`，会接管内置 Kilo 车道——目前只允许这一个值。
