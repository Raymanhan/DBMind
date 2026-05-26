# DBMind Release Guide

DBMind uses a private source repository for builds and a public repository for installer downloads.

| Repository | Visibility | Purpose |
|------------|------------|---------|
| `Raymanhan/dbmind-source` | Private | Source code, CI, build workflow, secrets |
| `Raymanhan/DBMind` | Public | README, LICENSE, GitHub Releases, installer assets |

Source code must remain in the private repository. Public Releases should contain installer assets only; GitHub may still show generated source archives for the public repository tag, but that public repository does not contain the private source tree.

## Release Version

The release version is read from `package.json` and must match the Git tag.

| Item | Format | Example |
|------|--------|---------|
| `package.json` version | `x.y.z` | `0.2.3` |
| Git tag | `vx.y.z` | `v0.2.3` |
| Release notes file | `docs/releases/vx.y.z.md` | `docs/releases/v0.2.3.md` |

## Required Release Notes

Every release must include explicit user-facing update notes. Do not rely on a commit message as the public Release body.

Create a file before tagging:

```bash
mkdir -p docs/releases
$EDITOR docs/releases/v0.2.3.md
```

Recommended structure:

```md
# DBMind v0.2.3

## 本次更新

- Clear user-visible change 1.
- Clear user-visible change 2.

## 安装包

- macOS Apple Silicon: `DBMind-0.2.3-mac-arm64.dmg`
- macOS Intel: `DBMind-0.2.3-mac-x64.dmg`
- Windows: `DBMind Setup 0.2.3.exe`
- Linux: `DBMind-0.2.3.AppImage`

## 验证

- `npm run typecheck`
- `npm run build`
```

## Automated Release

The workflow `.github/workflows/release.yml` runs on version tags (`v*`) and on manual dispatch.

There is also an emergency `main` push path for cases where GitHub refuses `workflow_dispatch` or does not enqueue a tag event. That path only runs when the pushed commit message contains `[release]`; ordinary `main` pushes are skipped by the workflow jobs.

For a normal release:

```bash
npm run typecheck
npm run build

git add package.json package-lock.json docs/releases/v0.2.3.md README.md
git commit -m "release: v0.2.3"
git push source main

git tag v0.2.3
git push source v0.2.3
```

The workflow will:

1. Resolve the version and release notes.
2. Build four platform packages:
   - macOS Apple Silicon (`arm64`)
   - macOS Intel (`x64`)
   - Windows (`x64`)
   - Linux (`x64`)
3. Upload build artifacts.
4. Publish or update `Raymanhan/DBMind` Release with explicit notes and installer assets.

## Manual Rerun

Use this when a tag already exists or a previous release job failed after the code was built.

```bash
gh workflow run "Build & Release" \
  --repo Raymanhan/dbmind-source \
  --ref main \
  -f version=v0.2.3
```

If `docs/releases/v0.2.3.md` does not exist on the selected ref, provide notes explicitly:

```bash
gh workflow run "Build & Release" \
  --repo Raymanhan/dbmind-source \
  --ref main \
  -f version=v0.2.3 \
  -f release_notes="$(cat docs/releases/v0.2.3.md)"
```

If GitHub returns a server error for `workflow_dispatch`, use the guarded main push path:

```bash
git commit --allow-empty -m "release: v0.2.3 [release]"
git push source main
```

## Secrets

| Secret | Repository | Purpose | Required permissions |
|--------|------------|---------|----------------------|
| `PUBLIC_REPO_TOKEN` | `Raymanhan/dbmind-source` | Create/update Releases in `Raymanhan/DBMind` | `public_repo` or `repo` |
| `SOURCE_REPO_TOKEN` | `Raymanhan/dbmind-source` | Checkout the private source repository when the default Actions token is unavailable | `repo` |

Set or rotate secrets with:

```bash
gh secret set PUBLIC_REPO_TOKEN --repo Raymanhan/dbmind-source --body 'ghp_xxx'
gh secret set SOURCE_REPO_TOKEN --repo Raymanhan/dbmind-source --body 'ghp_xxx'
```

The workflow uses `SOURCE_REPO_TOKEN` for checkout to avoid release failures caused by an unavailable default token. It uses `PUBLIC_REPO_TOKEN` only for the public Release publishing step.

## Monitoring

```bash
gh run list --repo Raymanhan/dbmind-source --workflow release.yml --limit 10
gh run view <run-id> --repo Raymanhan/dbmind-source --json jobs --jq '.jobs[] | "\(.name): \(.status) \(.conclusion // "")"'
gh run view <run-id> --repo Raymanhan/dbmind-source --log-failed
```

Check the public Release:

```bash
gh release view v0.2.3 --repo Raymanhan/DBMind --web
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Checkout fails with `403` in release or build jobs | Default Actions token cannot access the private source repo | Set or rotate `SOURCE_REPO_TOKEN` |
| Release job cannot create public Release | Missing or expired `PUBLIC_REPO_TOKEN` | Rotate `PUBLIC_REPO_TOKEN` |
| Release notes are missing | `docs/releases/vx.y.z.md` missing and no manual notes provided | Add the notes file or pass `release_notes` |
| Release has missing assets | Packaging or artifact flattening failed | Inspect failed job logs and rerun after fixing |
| `typecheck` fails | TypeScript errors | Run `npm run typecheck` locally and fix before tagging |
| macOS signing fails locally | Local machine has no signing identity | Use `CSC_IDENTITY_AUTO_DISCOVERY=false` for unsigned local test packages |

## Release Checklist

- [ ] `package.json` and `package-lock.json` versions are updated.
- [ ] `docs/releases/vx.y.z.md` exists and lists clear update content.
- [ ] README latest release section is updated.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] Changes are committed and pushed to `source/main`.
- [ ] Tag `vx.y.z` is pushed.
- [ ] CI build jobs for macOS arm64, macOS x64, Windows x64, and Linux x64 succeed.
- [ ] Public Release `Raymanhan/DBMind@vx.y.z` exists.
- [ ] Public Release has four installer assets and clear release notes.
