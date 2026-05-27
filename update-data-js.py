#!/usr/bin/env python3
import json
from pathlib import Path

data_path = Path("data/family-data.json")
js_path = Path("data/family-data.js")

data = json.loads(data_path.read_text(encoding="utf-8"))
js_path.write_text("window.FAMILY_TREE_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
print(f"Updated {js_path}")
