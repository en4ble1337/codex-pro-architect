#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
review = root / "docs" / "SECOND-AGENT-REVIEW.md"
text = review.read_text(encoding="utf-8")
text = text.replace("## Important Findings\n\nNone after fixes.", "## Important Findings\n\nNone.")
text = text.replace("## Critical Findings\n\nNone after fixes.", "## Critical Findings\n\nNone.")
review.write_text(text, encoding="utf-8")
