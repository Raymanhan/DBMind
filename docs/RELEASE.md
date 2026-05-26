# DBMind 打包发布规则

## 仓库架构

| 仓库 | 地址 | 可见性 | 内容 |
|------|------|--------|------|
| **公开仓库** | `Raymanhan/DBMind` | Public | README、LICENSE、GitHub Releases（仅安装包） |
| **私有仓库** | `Raymanhan/dbmind-source` | Private | 完整源码 + CI 构建 + Secret 配置 |

**原则**：源码永远只推送到私有仓库。公开仓库仅作为下载入口，不包含任何源码。

---

## 一、版本号管理

版本号遵循 `package.json` 中的 `version` 字段，格式为 `x.y.z`（语义化版本）。

Git tag 格式为 `vx.y.z`，例如 `v0.2.0`。

版本号与 tag 必须一致。CI 在 workflow_dispatch 触发时自动从 `package.json` 读取版本号。

### 发版前更新版本号

```bash
# 修改 package.json 中的 version 字段
# 例如从 0.1.0 改为 0.2.0

# 提交
git add package.json package-lock.json
git commit -m "chore: bump version to 0.2.0"
git push source main
```

---

## 二、CI 自动打包（推荐）

### 触发方式

在私有仓库打 tag 并推送即自动触发全平台构建和发布：

```bash
# 确保本地在 main 分支且已推送最新代码
git tag v0.2.0
git push source v0.2.0
```

### CI 构建流程

1. 4 个 job 并行构建：`mac (arm64)` / `mac (x64)` / `win (x64)` / `linux (x64)`
2. 每个 job 执行：`npm ci` → `typecheck` → `build` → `electron-builder` → 上传 artifact
3. Release job 等待 4 个构建完成后：下载 artifacts → 提取安装包 → 推送到公开仓库 Release

### 查看 CI 进度

```bash
gh run list --repo Raymanhan/dbmind-source --limit 3
gh run view <run-id> --repo Raymanhan/dbmind-source --json jobs --jq '.jobs[] | "\(.name): \(.status) \(.conclusion // "")"'
```

### 产物

| 平台 | 文件名 | 大小参考 |
|------|--------|----------|
| macOS Apple Silicon | `DBMind-x.y.z-mac-arm64.dmg` | ~133 MB |
| macOS Intel | `DBMind-x.y.z-mac-x64.dmg` | ~138 MB |
| Windows | `DBMind Setup x.y.z.exe` | ~110 MB |
| Linux | `DBMind-x.y.z.AppImage` | ~138 MB |

### 手动触发 CI

如果 tag push 未触发（例如 tag 已存在指向同一 commit），可手动触发：

```bash
gh workflow run "Build & Release" --repo Raymanhan/dbmind-source --ref main
```

> 手动触发时版本号从 `package.json` 读取，不会创建重复 Release，而是追加 assets 到已有 Release。

---

## 三、本地手动打包（仅 macOS）

> 仅用于 macOS 本地测试。Windows/Linux 必须走 CI，因为 mysql2/pg 含原生模块，无法在 macOS 上交叉编译。

### 步骤

```bash
# 1. 构建
npm run build

# 2. 打包 macOS ARM64
npx electron-builder --mac --arm64 --publish never

# 3. 打包 macOS Intel（交叉编译，需要 Rosetta 2）
npx electron-builder --mac --x64 --publish never

# 4. 产物在 release/ 目录
ls -lh release/*.dmg
```

### 手动上传

1. 确保公开仓库已有对应版本的 Release
2. 如果未创建，先在 GitHub 网页创建：
   - 访问 https://github.com/Raymanhan/DBMind/releases/new
   - Tag: 选择或创建对应版本
   - Title: `DBMind v0.2.0`
3. 上传 DMG 文件

或用命令行：

```bash
# 创建 Release 并上传
gh release create v0.2.0 release/DBMind-0.2.0-mac-*.dmg \
  --repo Raymanhan/DBMind \
  --title "DBMind v0.2.0"

# 或向已有 Release 追加文件
gh release upload v0.2.0 release/DBMind-0.2.0-mac-arm64.dmg --repo Raymanhan/DBMind --clobber
```

---

## 四、公开仓库 README 更新

如果 Release 有重大新功能，更新公开仓库的 README：

```bash
# 在 dbmind-public 目录
cd /path/to/dbmind-public
# 编辑 README.md，更新 Features 列表

git add README.md
git commit -m "docs: update features for v0.2.0"
git push origin main
```

---

## 五、Secret 管理

私有仓库的 CI 需要一个 Secret 用于推送到公开仓库：

| Secret 名称 | 用途 | 所需权限 |
|-------------|------|----------|
| `PUBLIC_REPO_TOKEN` | 在 `Raymanhan/DBMind` 创建 Release / 上传 assets | `public_repo` |

### 设置 Secret

```bash
gh secret set PUBLIC_REPO_TOKEN --body 'ghp_xxx' --repo Raymanhan/dbmind-source
```

### Token 要求

- 类型：GitHub Personal Access Token (Classic)
- 权限：`public_repo`、`workflow`
- 来源：https://github.com/settings/tokens

---

## 六、故障排查

### CI 构建失败

```bash
# 查看失败 job 日志
gh run view <run-id> --repo Raymanhan/dbmind-source --log-failed
```

常见原因：
- **typecheck 失败**：本地运行 `npm run typecheck` 修复类型错误
- **electron-builder 403**：`GITHUB_TOKEN` 缺少权限或 `--publish never` 未设置
- **Release job 找不到文件**：artifact 下载步骤顺序错误，确保 checkout 在 download 之前

### Release 没有更新公开仓库

```bash
# 检查 Release job 日志
gh run view <run-id> --repo Raymanhan/dbmind-source --log --job <release-job-id>
```

常见原因：
- `PUBLIC_REPO_TOKEN` 未设置或已过期
- Token 缺少 `public_repo` 权限
- 版本号字符串格式不正确

### 本地 electron-builder 签名错误

```bash
# macOS 无签名构建（开发/测试用）
export CSC_IDENTITY_AUTO_DISCOVERY=false
npx electron-builder --mac --arm64 --publish never
```

签名仅用于分发，CI 已配置跳过签名。本地测试不需要签名。

---

## 七、完整发版 Checklist

- [ ] `package.json` version 已更新
- [ ] `npm run typecheck` 通过（两个 tsconfig）
- [ ] `npm run build` 通过
- [ ] 提交并推送版本号变更：`git push source main`
- [ ] 打 tag：`git tag vx.y.z && git push source vx.y.z`
- [ ] 确认 CI 4 个平台构建全部成功
- [ ] 确认 Release job 成功推送到 `Raymanhan/DBMind`
- [ ] 访问 https://github.com/Raymanhan/DBMind/releases 验证 4 个安装包均已上传
- [ ] 如有重大功能更新，更新公开仓库 README
