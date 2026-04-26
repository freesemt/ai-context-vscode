# ai-context-vscode

VS Code extension providing two features for AI-assisted development:

1. **Language model tools** for reading live notebook cell outputs — no save required, no size limit
2. **VS Code version recording** — writes `.github/vscode-version.txt` on startup (supersedes `vscode-version-recorder`)

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

---

## Installation

### From source (development)

```bash
cd ai-context-vscode
npm install
npm run compile
```

Then press **F5** in VS Code to launch an Extension Development Host, or package it:

```bash
npx @vscode/vsce package
code --install-extension ai-context-vscode-0.2.0.vsix
```

---

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
