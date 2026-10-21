<!-- AI Context Standard v0.10.0 - Adopted: 2026-05-12 -->
# AI Assistant Initialization Guide — ai-context-vscode

**Purpose**: Initialize AI context for working in this repository

---

## What this repository is about

`ai-context-vscode` is a VS Code extension providing two features for AI-assisted development:

1. **Language model tools** for reading live notebook cell outputs — no save required, no size limit:
   - `aicReadLiveCellOutput` — reads output directly from the VS Code document model
   - `aicRunCellAsync` — fires a notebook cell and returns immediately (fire-and-forget)
   - `aicKernelEval` — evaluates a Python expression **or multi-line code block** in the active kernel without inserting a cell; single-line: wraps as `repr(...)`; multi-line: executes block + repr's final expression if it is an expression (v0.5.5, fixes issue #3)
   - `aicListNotebookCells` — lists all cells with execution status (`*` = running, number = done)
2. **VS Code version recording** — writes `.github/vscode-version.txt` in each workspace folder on startup (supersedes `vscode-version-recorder`)
3. **Status bar indicator** (v0.4.0+) — reads current task at startup (6s delay) using the coordinator pattern (AI Context Standard v0.10.0): if `WORKSPACE_STATUS.md` exists in any workspace folder, uses it as coordinator; otherwise falls back to `PROJECT_STATUS.md` in all folders; click to dismiss
4. **Guarded Clear All Outputs** (v0.5.0+) — toolbar button `aic.clearAllOutputsGuarded` for Jupyter notebooks. Before clearing, queries the kernel for any live thread whose name starts with `aic-active-`. If found, shows a confirmation modal. Falls through to `notebook.clearAllCellsOutputs` immediately when no notebook is open, the kernel is unavailable, the 2s query times out, or no active threads are found. Libraries opt in by naming daemon threads with the `aic-active-` prefix (e.g. `name='aic-active-optimizer'`).
5. **`aicEditNotebookCell` display-vs-edit clarification** (v0.5.4) — `modelDescription` now includes an explicit `IMPORTANT` note: the `VSCode.Cell` XML blocks in chat responses are display-only and do NOT apply any edit; calling this tool explicitly is the only way to make an actual change. Fixes issue #5.

Part of the [AI Context Standard](https://github.com/freesemt/ai-context-standard) ecosystem.

---

## Repository structure

```
ai-context-vscode/
├── .github/
│   ├── copilot-instructions.md  ← this file
│   ├── prompts/
│   │   └── init.prompt.md
│   └── vscode-version.txt
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── extension.ts    ← all extension logic
```

---

## Building and installing

Build and package (requires `vsce`):
```powershell
npm install
npx vsce package
```

Install from VSIX:
```powershell
code-insiders --install-extension ai-context-vscode-0.x.x.vsix
```

Install from latest GitHub release:
```powershell
gh release download v0.2.0 --repo freesemt/ai-context-vscode --pattern "*.vsix" --dir $env:TEMP
code-insiders --install-extension "$env:TEMP\ai-context-vscode-0.2.0.vsix"
```

---

## Git and shell quirks on Windows PowerShell

Shared rules from [ai-context-standard](https://github.com/freesemt/ai-context-standard) v0.10.2 ("PowerShell Terminal — Native-command Output and Commit Messages"):

- A red `NativeCommandError` after `git push` / `fetch` or `gh` is stderr progress, not failure. Judge by the result line (`a1b2c3d..e4f5a6b  main -> main`, `✓ Closed issue`) or `git status -sb`; do not retry.
- Commit messages (and `gh ... --body-file` text): write to a fresh file with the editor's create tool, then `git commit -F <file>`. `git commit -F -` from a here-string fails. Keep trailers such as `Co-authored-by:`.
- `| Select-Object -Last N` buffers output until the command ends; silence is expected.
- Tool calls in one batch run in parallel: read an artifact in a later batch than the call that creates it.

## Response language

**Response language**: English
