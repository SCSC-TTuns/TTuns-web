## TTuns Web

### Local sugang dataset

The API now reads local JSON files from `data/sugang` instead of calling external SNUTT API.

- Expected file pattern: `data/sugang/{year}-{semester}.json`
- Canonical semester: `1=1st`, `2=summer`, `3=2nd`, `4=winter`

Example:

- `data/sugang/2024-1.json`
- `data/sugang/2024-2.json`
- `data/sugang/2024-3.json`
- `data/sugang/2024-4.json`
- `data/sugang/2026-1.json`

You can override dataset directory with `SNUTT_LOCAL_DATA_DIR`.

### ChatGPT Apps/MCP test environment

Run the app on port `3001` (required by current MCP endpoint examples):

```bash
npm run dev -- -p 3001
```

Health check:

```bash
curl -sS http://localhost:3001/mcp | jq .
```

Open local MCP Inspector (for ChatGPT Apps-style MCP testing):

```bash
npm run mcp:inspector
```

For `search_timetable`, semester aliases are normalized:

- `1`, `spring`, `1학기`, `봄` -> `1`
- `2`, `summer`, `여름` -> `2`
- `3`, `fall`, `autumn`, `2학기`, `가을` -> `3`
- `4`, `winter`, `겨울` -> `4`

### Crawl sugang data

Install crawler dependencies:

```bash
pip install requests xlrd
```

Run full crawl (2024-1 ~ 2026-1):

```bash
python3 dev/crawl_sugang.py
```

Run smoke crawl:

```bash
python3 dev/crawl_sugang.py --term 2026-1 --max-details 20 --force
```

Useful options:

- `--workers 8`
- `--term 2026-1` (can repeat)
- `--max-details N`
- `--out-dir data/sugang`
- `--force`
- `--keep-xls`

### Format Guideline

1. How to format on save

- Install prettier plugin on your computer. //`https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode`
- Please add following setup on your `.vscode/settings.json`.

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  // Match your project
  "eslint.useFlatConfig": true,
  "eslint.validate": ["javascript", "javascriptreact", "typescript", "typescriptreact"],
  // For Next.js projects
  "eslint.workingDirectories": [{ "mode": "auto" }]
}
```

2. How to format using cli?

전역적으로 한번에 포멧팅하기 위해서는 다음과 같은 명령어를 사용합니다.

```bash
npx prettier --write .
```
