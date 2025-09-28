## TTuns Web(https://ttuns-web.vercel.app/)

### Format Guideline

1. How to format on save

- Install prettier plugin on your computer.
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

