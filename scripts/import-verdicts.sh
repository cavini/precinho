#!/usr/bin/env bash
# Imports every verdict file that has not been imported yet.
#
# Each batch is tagged with the file it came from, so product_merges can
# say which judging run is behind a merge that turns out wrong.
set -euo pipefail
cd "$(dirname "$0")/.."

for file in .judging/veredito-*; do
  name=$(basename "$file")
  marker=".judging/.importado-$name"
  [ -f "$marker" ] && continue

  python3 - "$file" "$name" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
out = []
for line in open(path, encoding='utf-8'):
    if not line.strip():
        continue
    row = json.loads(line)
    row['by'] = f'claude ({name})'
    out.append(json.dumps(row, ensure_ascii=False))
open('.judging/importar.jsonl', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
PY

  echo "== $name =="
  npx tsx scripts/judge-equivalences.ts --import .judging/importar.jsonl 2>&1 | grep importei
  touch "$marker"
done
