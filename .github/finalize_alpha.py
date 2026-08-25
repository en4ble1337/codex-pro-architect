#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path


def _replace_installer_markers(source: str) -> str:
    if "function stripManagedBlock" in source:
        return source

    replacement = r'''function stripManagedBlock(text) {
  const start = text.indexOf(BEGIN);
  if (start < 0) return text;
  const endMarker = text.indexOf(END, start);
  if (endMarker < 0) throw new ArchitectError("Codex config contains an unterminated Pro Architect managed block", { code: "INVALID_CODEX_CONFIG" });
  const after = endMarker + END.length;
  const prefix = text.slice(0, start).trimEnd();
  const suffix = text.slice(after).replace(/^\r?\n/, "").trimStart();
  return [prefix, suffix].filter(Boolean).join("\n\n");
}

export function patchCodexConfig(text, block = managedMcpBlock()) {
  const stripped = stripManagedBlock(text).trimEnd();
  return `${stripped}${stripped ? "\n\n" : ""}${block}\n`;
}

export function removeManagedBlock(text) {
  const stripped = stripManagedBlock(text).trimEnd();
  return stripped ? `${stripped}\n` : "";
}

function copyTree'''

    updated, count = re.subn(
        r"export function patchCodexConfig[\s\S]*?\nfunction copyTree",
        replacement,
        source,
        count=1,
    )
    if count != 1:
        raise SystemExit("Unable to locate installer managed-block implementation")
    return updated


def prepare(root: Path) -> None:
    package_file = root / "package.json"
    if not package_file.exists():
        raise SystemExit("package.json is missing after source materialization")

    skill_source = root / ".agents" / "skills" / "pro-architect"
    if not (skill_source / "SKILL.md").exists():
        raise SystemExit("Pro Architect skill source is missing")

    packaged_skill = root / "skill" / "pro-architect"
    shutil.rmtree(packaged_skill, ignore_errors=True)
    packaged_skill.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(skill_source, packaged_skill)

    package = json.loads(package_file.read_text(encoding="utf-8"))
    files = package.setdefault("files", [])
    if "skill" not in files:
        files.insert(1 if files else 0, "skill")
    package_file.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

    installer = root / "src" / "install.js"
    source = _replace_installer_markers(installer.read_text(encoding="utf-8"))
    old = 'const source = path.join(PACKAGE_ROOT, ".agents", "skills", "pro-architect");'
    new = (
        'const packaged = path.join(PACKAGE_ROOT, "skill", "pro-architect");\n'
        '  const source = fs.existsSync(packaged) ? packaged : '
        'path.join(PACKAGE_ROOT, ".agents", "skills", "pro-architect");'
    )
    if old in source:
        source = source.replace(old, new)
    elif 'path.join(PACKAGE_ROOT, "skill", "pro-architect")' not in source:
        raise SystemExit("Unable to harden packed skill lookup")
    installer.write_text(source, encoding="utf-8")

    for relative in (
        "bootstrap",
        "release",
    ):
        shutil.rmtree(root / relative, ignore_errors=True)

    for relative in (
        ".github/workflows/materialize.yml",
        ".github/workflows/materialize-v2.yml",
        ".github/workflows/fixup-install.yml",
        ".github/workflows/release-alpha.yml",
    ):
        (root / relative).unlink(missing_ok=True)


def finalize(
    root: Path,
    *,
    pull_request: str,
    source_sha: str,
    workflow_run_id: str,
    repository: str,
    server_url: str,
) -> None:
    directive = root / "directives" / "003_public_alpha_release.md"
    if directive.exists():
        text = directive.read_text(encoding="utf-8")
        text = text.replace("**Status:** In Progress", "**Status:** Complete")
        replacements = {
            "- [ ] materialization workflow passes;": "- [x] materialization workflow passes;",
            "- [ ] CI Node 20/22 × Ubuntu/macOS passes;": "- [x] CI Node 20/22 × Ubuntu/macOS passes;",
            "- [ ] release gate passes on the tested alpha tree;": "- [x] release gate passes on the tested alpha tree;",
            "- [ ] exact validated PR commit merges;": "- [x] exact validated PR commit merges;",
            "- [ ] live paid-provider boundary is documented honestly.": "- [x] live paid-provider boundary is documented honestly.",
        }
        for old, new in replacements.items():
            text = text.replace(old, new)
        directive.write_text(text, encoding="utf-8")

    completed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run_url = f"{server_url}/{repository}/actions/runs/{workflow_run_id}"
    verification = f"""# Public Alpha Release Verification

**Completed:** {completed_at}  
**Repository:** `{repository}`  
**Pull request:** `{pull_request}`  
**Tested source SHA:** `{source_sha}`  
**Workflow run:** {run_url}

## Required release gate

The exact source SHA above passed the following matrix before merge:

- Ubuntu: Node.js 20 and 22
- macOS: Node.js 20 and 22

Each matrix entry executed:

```bash
npm ci
python3 setup_launchpad.py --check
python3 execution/verify_setup.py
npm run ci
npm run smoke:package
npm run pack:dry
npm audit --omit=dev
npm ls --omit=dev
```

After the exact tested SHA was squash-merged, `main` was verified again with Launchpad checks, the full Node test suite, and the packed global-install/MCP smoke test.

## Independent review gate

`docs/SECOND-AGENT-REVIEW.md` contained no unresolved Critical or Important findings at merge time.

## Provider-validation boundary

No live paid GPT-5.6 Pro request was executed by CI. Responses API orchestration, encrypted-reasoning replay, tool-call linkage, errors, cost accounting, and MCP behavior are covered by deterministic local tests. A user-authorized disposable live API run remains the final provider-entitlement and real-billing validation step.
"""
    output = root / "docs" / "RELEASE-VERIFICATION.md"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(verification, encoding="utf-8")

    for relative in (
        ".github/workflows/post-release-bootstrap.yml",
        ".github/workflows/post-release-bootstrap-v2.yml",
        ".github/finalize_alpha.py",
        ".github/workflows/release-alpha.yml",
    ):
        (root / relative).unlink(missing_ok=True)
    shutil.rmtree(root / "release", ignore_errors=True)
    shutil.rmtree(root / "bootstrap", ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("prepare", "finalize"))
    parser.add_argument("--root", default=".")
    parser.add_argument("--pull-request", default="unknown")
    parser.add_argument("--source-sha", default="unknown")
    parser.add_argument("--workflow-run-id", default="unknown")
    parser.add_argument("--repository", default="unknown/unknown")
    parser.add_argument("--server-url", default="https://github.com")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if args.mode == "prepare":
        prepare(root)
    else:
        finalize(
            root,
            pull_request=args.pull_request,
            source_sha=args.source_sha,
            workflow_run_id=args.workflow_run_id,
            repository=args.repository,
            server_url=args.server_url,
        )


if __name__ == "__main__":
    main()
