# ai-context-vscode

VS Code extension providing four features for AI-assisted development:

1. **Language model tools** for reading and editing live notebook cell outputs — no save required, no size limit
2. **VS Code version recording** — writes `.github/vscode-version.txt` on startup (supersedes `vscode-version-recorder`)
3. **Status bar indicator** — reads current task at startup (6s delay) using the coordinator pattern; click to dismiss
4. **Guarded Clear All Outputs** — toolbar button that checks for active background threads before wiping notebook outputs

Part of the [AI Context Standard](https://github.com/freesemt/ai-context-standard) ecosystem.

---

## Why this exists

The built-in `read_notebook_cell_output` tool in VS Code frequently fails with "Output is too large" even for modest stdout output. When it fails, the only workaround is to save the notebook and use a file-based fallback.

This extension solves both problems:
- **No size limit**: Reads outputs directly from the live VS Code document model
- **No save required**: Works with unsaved notebooks — you get results immediately after cell execution

---

## VS Code version recording

On every startup, writes `.github/vscode-version.txt` in each workspace folder that has a `.github` directory:

```text
# VS Code version used in this workspace
# Auto-updated by vscode-version-recorder extension
# Required for alwaysApply: true in init.prompt.md (VS Code 1.99+)
1.115.0-insider
```

This file is read by `init.prompt.md` (`alwaysApply: true`) to verify the VS Code version before running initialization prompts. This feature was previously provided by the separate `vscode-version-recorder` extension, which is now superseded by this extension.

---

## Status bar indicator

On startup (after a 6-second delay), displays the current task in the VS Code status bar. Uses the **coordinator pattern** from [AI Context Standard v0.10.0](https://github.com/freesemt/ai-context-standard):

- **Multi-root workspace with coordinator**: If any workspace folder contains `WORKSPACE_STATUS.md`, that repo is the coordinator. Its `## 🎯 Current Task` section is shown as a single status bar entry.
- **Single-repo or no coordinator**: Falls back to scanning all workspace folders for `PROJECT_STATUS.md` and displaying each repo's current task, separated by `|`.

```
✅ AI Context: Working on feature X
```

Click the item to dismiss it. If no status file is found, the status bar item is not shown.

The current task is extracted from the `## 🎯 Current Task` section of the status file. The first non-blank, non-heading line after the section header is used.

---

## Tools provided

### `aicReadLiveCellOutput`

Read the output of a specific notebook cell.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cellNumber` | number | Yes | 1-based cell number |
| `notebookUri` | string | No | Notebook URI. Defaults to active notebook |
| `maxCharacters` | number | No | Max characters to return (default: 200,000) |

Returns stdout, stderr, text/plain, and error outputs as text. Image outputs are noted with their mime type and size.

### `aicListNotebookCells`

List all cells in a notebook with metadata and output summary.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `notebookUri` | string | No | Notebook URI. Defaults to active notebook |

Returns: cell number, type (code/markdown), execution count, source preview, and output mime types.

### `aicKernelEval`

Evaluate a Python expression in the live Jupyter kernel of an open notebook and return the result as text. Built on `ms-toolsai.jupyter`'s `api.kernels.getKernel(uri)` API.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expression` | string | Yes | Python expression to evaluate (e.g. `"run.live_status()"`) |
| `notebookUri` | string | No | Notebook URI. Defaults to active notebook |
| `maxCharacters` | number | No | Max characters to return (default: 200,000) |

Returns the `repr` of the expression's value. Use this to query in-flight optimizer state, inspect arbitrary kernel-scope objects, or pull derived values without inserting and running a new cell.

**Example use cases**:
- Probe a long-running job: `aicKernelEval(expression="run_sub.live_status()")`
- Inspect a fitted model mid-iteration: `aicKernelEval(expression="model.score_breakdown()")`
- Read a deeply-nested attribute the human hasn't surfaced in a cell

**Requires**: the `ms-toolsai.jupyter` extension and a running kernel for the target notebook.

### `aicRunCellAsync`

Start executing a notebook cell without blocking the chat.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cellNumber` | number | Yes | 1-based cell number |
| `notebookUri` | string | No | Notebook URI. Defaults to active notebook |

Returns `{ok: true, started: true}` immediately — before the cell finishes.

**Use this for** long-running cells (optimizers, training runs, multi-hour analyses) where `run_notebook_cell` would block the conversation.

**Workflow after firing**:
1. `aicListNotebookCells()` — execution count shows `*` while running, changes to a number when done
2. `aicReadLiveCellOutput(cellNumber=N)` — read the output once finished

**Requires**: the notebook must be open in the VS Code editor.

### `aicEditNotebookCell`

Write new source into a notebook cell using VS Code's live document model.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cellNumber` | number | Yes | 1-based cell number |
| `newSource` | string | Yes | Replacement source text |
| `notebookUri` | string | No | Notebook URI. Defaults to active notebook |

Returns `{ok: true, cellNumber, language}` on success. Markdown cells are scrolled into view after the edit so VS Code re-renders their HTML immediately — no manual click required.

**Why not `edit_notebook_file`?** That tool writes to disk. When a notebook is open in VS Code, the in-memory model shadows the disk write — the change is invisible until the editor is reloaded. `aicEditNotebookCell` bypasses this by editing the live document model directly, exactly as a human would type in the cell.

**Use this for** editing cell source (both code and markdown) while the notebook is open. For notebooks not currently open in VS Code, `edit_notebook_file` remains the correct tool.

---

## Guarded Clear All Outputs

The standard **Clear All Outputs** toolbar button in Jupyter notebooks wipes all cell outputs immediately, with no warning — even if a long-running background job (optimizer, training run) is actively writing to those cells.

This extension adds a parallel toolbar button **`aic.clearAllOutputsGuarded`** ($(clear-all) icon) that checks first:

1. Sends a silent Python query to the live kernel:
   ```python
   any(t.is_alive() for t in threading.enumerate()
       if t.name.startswith('aic-active-'))
   ```
2. If any `aic-active-*` thread is alive → shows a **confirmation modal** before clearing.
3. If none are found, the kernel is unavailable, or the query times out (2s) → clears immediately.

**Fall-throughs** (clears with no prompt):
- No notebook is open
- Kernel is dead or not started
- 2-second query timeout
- No `aic-active-*` threads found

### How libraries opt in

Name background daemon threads with the `aic-active-` prefix:

```python
import threading

t = threading.Thread(target=my_long_job, daemon=True, name='aic-active-optimizer')
t.start()
```

The extension is framework-agnostic — any Python library can use this convention.
[molass-legacy](https://github.com/biosaxs-dev/molass-legacy) adopts it for its in-process optimizer and watch threads.

---

## Installation

### For everyone (recommended)

1. Go to the [latest release](https://github.com/freesemt/ai-context-vscode/releases/latest)
2. Download `ai-context-vscode-x.x.x.vsix`
3. Open VS Code → Extensions panel (`Ctrl+Shift+X`)
4. Click `···` (top-right menu) → **Install from VSIX...**
5. Select the downloaded file and reload VS Code

### From source (development)

```bash
cd ai-context-vscode
npm install
npm run compile
```

Then press **F5** in VS Code to launch an Extension Development Host, or package it:

```bash
npx @vscode/vsce package
code --install-extension ai-context-vscode-0.5.3.vsix
```

## Relationship to ai-context-tools

| | **ai-context-vscode** (this) | **[ai-context-tools](https://github.com/freesemt/ai-context-tools)** |
|---|---|---|
| Runtime | VS Code extension | Python package (PyPI) |
| Reads from | Live document model | Saved `.ipynb` on disk |
| Requires save? | **No** | Yes |
| Size limit | None (configurable) | None |
| Works outside VS Code | No | Yes |

**Recommendation**: Use this extension as the primary tool in VS Code. Fall back to `pip install ai-context-tools` for terminal-only sessions or non-VS Code editors.

---

## License

MIT
