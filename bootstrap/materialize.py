#!/usr/bin/env python3
from pathlib import Path
import materialize_core
import materialize_docs

ROOT = Path(__file__).resolve().parents[1]

materialize_core.write_files()
materialize_docs.write_files()

# Remove one-use bootstrap sources and workflow from the generated public tree.
for relative in [
    "bootstrap/materialize_core.py",
    "bootstrap/materialize_docs.py",
    "bootstrap/materialize.py",
    ".github/workflows/materialize.yml",
]:
    target = ROOT / relative
    if target.exists():
        target.unlink()
bootstrap = ROOT / "bootstrap"
if bootstrap.exists() and not any(bootstrap.iterdir()):
    bootstrap.rmdir()

print("Codex Pro Architect source tree materialized.")
