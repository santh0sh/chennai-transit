#!/usr/bin/env python3
"""One-off transcription helper.

Reads the saved text of the published Southern Railway (Chennai Division) revised
suburban timetable (press release PUB/MAS/2026/05/25, 30 May 2026, effective
01 Jun 2026) and writes the four raw CSV files the Java importer consumes.
It copies cells verbatim; all interpretation happens in the importer.
"""
import re, sys, csv, pathlib

src = pathlib.Path(sys.argv[1]).read_text()
out = pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)

sections = [
    ("weekday-down", "▼ Down — MSB (Chennai Beach)"),
    ("weekday-up",   "▲ Up — AJJ/TMLP/CGL → TBM → MSB (Chennai Beach)"),
    ("sunday-down",  "▼ Down — MSB → CGL / AJJ (Sunday"),
    ("sunday-up",    "▲ Up — AJJ/TMLP/CGL → TBM → MSB (Sunday)"),
]
lines = src.splitlines()
starts = []
for name, marker in sections:
    idx = next(i for i, l in enumerate(lines) if l.startswith(marker))
    starts.append((name, idx))
starts.sort(key=lambda x: x[1])
for k, (name, idx) in enumerate(starts):
    end = starts[k + 1][1] if k + 1 < len(starts) else len(lines)
    rows = []
    for l in lines[idx:end]:
        if l.startswith("|") and not l.startswith("| ---"):
            cells = [c.strip() for c in l.strip().strip("|").split("|")]
            rows.append(cells)
    with open(out / f"suburban-{name}.csv", "w", newline="") as f:
        rows[0][0] = "n"; csv.writer(f).writerows(rows)
    print(name, len(rows) - 1, "trains")
