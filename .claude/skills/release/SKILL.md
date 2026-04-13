---
name: release
description: Create a GitHub release for TAI - bumps version, generates release notes, tags, pushes, and creates a release. By default uses CI to build artifacts; pass `local_build` to build locally and publish immediately. Usage: /release <patch|minor|major> [local_build] [e2e]
user_invocable: true
---

# /release

Create a release for TAI. Bumps version, generates release notes, tags, pushes, and creates a GitHub release.

By default, uses GitHub Actions to build artifacts for all platforms and publish. Pass `local_build` to build locally and publish immediately.

## Usage

```
/release patch
/release minor
/release major
/release patch local_build
/release minor local_build e2e
```

The bump argument (`patch`, `minor`, `major`) is required. Optional flags:
- `local_build` — build artifacts locally and publish the release immediately (no CI)
- `e2e` — run E2E tests before releasing

## Instructions

When the user invokes `/release <bump> [local_build] [e2e]`, follow these steps exactly:

### Step 1: Parse arguments

- Extract the bump type: must be one of `patch`, `minor`, or `major`. If missing or invalid, abort: "Usage: `/release <patch|minor|major> [local_build] [e2e]`"
- Check if `local_build` is present in the arguments.
- Check if `e2e` is present in the arguments.

### Step 2: Validate

1. Run `git status --porcelain` — if output is non-empty, abort: "Working tree is dirty. Commit or stash changes first."
2. Run `git branch --show-current` — if not `master`, abort: "Must be on the master branch to release."
3. Run `git pull --ff-only` — if it fails, warn the user and stop.

### Step 3: Run Tests

Run the test suite before proceeding:

```bash
npm test
```

If any tests fail, STOP immediately. Show the failing test output to the user and do NOT proceed with the release. Tell them to fix the failing tests first.

If `e2e` was specified:

```bash
npm run test:e2e
```

If E2E tests fail, STOP and show the output. Do NOT proceed with the release.

### Step 4: Bump version

1. Read `package.json`.
2. Parse the current `version` field (semver: `MAJOR.MINOR.PATCH`).
3. Increment the segment specified by the bump argument, resetting lower segments to 0.
4. Write the updated version back to `package.json` (change only the version field, preserve everything else).
5. Tell the user the old and new version.

### Step 5: Generate release notes

1. Run `git describe --tags --abbrev=0` to find the previous tag. If no tags exist, use the root commit.
2. Run `git log <prev-tag>..HEAD --pretty=format:"%h %s"` to get commits since the last release.
3. Group commits into sections by conventional commit prefix:
   - `feat:` or `feat(...):`  -> **What's New**
   - `fix:` or `fix(...):`    -> **Bug Fixes**
   - Skip internal-only changes (`chore`, `ci`, `docs`, `style`, `refactor`, `test`, `build`, `release` commits) — users don't need to see these.
4. **Rewrite each entry in plain, user-facing language.** Strip the conventional commit prefix and scope. Describe the change from the user's perspective — what they can now do or what got fixed. Keep it concise but clear. Do not include commit hashes.
5. Omit empty sections.
6. Store the formatted notes for use later.

   Example output:
   ```markdown
   ## What's New
   - Browse files with the new file explorer sidebar
   - Edit files in a full-featured code editor modal

   ## Bug Fixes
   - Fixed line numbers being cut off in narrow windows
   ```

### Step 6: Commit and tag

Run these commands sequentially:

```bash
git add package.json
git commit -m "release: v{NEW_VERSION}"
git tag v{NEW_VERSION}
```

### Step 7: Push

```bash
git push
git push --tags
```

### Step 8: Create release

#### If `local_build` is set:

Build artifacts locally:

```bash
npm run build
npx electron-builder --linux AppImage --win nsis --publish never
```

This produces files in the `release/` directory including the AppImage, exe installer, and update manifest yml files.

Then create a published release with artifacts attached:

```bash
gh release create v{NEW_VERSION} \
  release/*.AppImage \
  release/*.exe \
  release/latest-linux.yml \
  release/latest.yml \
  --title "v{NEW_VERSION}" \
  --notes "{RELEASE_NOTES}"
```

Do NOT use `--draft` — the release should be published immediately.

Tell the user:
- The new version number
- That the release was published with Linux AppImage and Windows installer attached
- Link to the release page

#### If `local_build` is NOT set (default):

Create a draft release:

```bash
gh release create v{NEW_VERSION} --draft --title "v{NEW_VERSION}" --notes "{RELEASE_NOTES}"
```

Use a heredoc for the notes body to preserve formatting.

Tell the user: "Draft release created. GitHub Actions is now building artifacts for Linux, Windows, and macOS."

Explain that the CI workflow will automatically:
- Build artifacts for all platforms (`.dmg`, `.exe`, `.AppImage`, auto-update manifests)
- Attach them to the draft release
- Publish the release (mark as non-draft) once all builds succeed

Provide the release URL:
```bash
gh release view v{NEW_VERSION} --json url --jq '.url'
```

Provide the Actions run link:
```bash
gh run list --workflow=release.yml --limit=1 --json url --jq '.[0].url'
```

### Error recovery

- If `git push` fails, the commit and tag are local only. Tell the user they can retry with `git push && git push --tags`.
- If `gh release create` fails, the tag is already pushed. Tell the user they can create the release manually on GitHub.
- If the workflow fails (CI mode), the draft release exists but has no/partial artifacts. Tell the user to check the Actions tab and re-run the failed jobs.
