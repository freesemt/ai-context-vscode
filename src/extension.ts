import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// VS Code Version Recorder  (absorbed from vscode-version-recorder)
// ---------------------------------------------------------------------------

function updateVersionFiles(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    const version = vscode.version;
    const content =
        `# VS Code version used in this workspace\n` +
        `# Auto-updated by vscode-version-recorder extension\n` +
        `# Required for alwaysApply: true in init.prompt.md (VS Code 1.99+)\n` +
        `${version}\n`;

    for (const folder of folders) {
        const dir = path.join(folder.uri.fsPath, '.github');
        const file = path.join(dir, 'vscode-version.txt');
        if (!fs.existsSync(dir)) continue;
        // Skip write if file already contains the current version — avoids
        // triggering VS Code file-watcher events on every startup, which can
        // cause notebook editor webviews to reload unexpectedly.
        try {
            if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) continue;
        } catch { /* fall through to write */ }
        fs.writeFileSync(file, content, 'utf8');
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEXT_MIME_TYPES = new Set([
    'text/plain',
    'application/vnd.code.notebook.stdout',
    'application/vnd.code.notebook.stderr',
    'application/vnd.code.notebook.error',
]);

function isTextMime(mime: string): boolean {
    return TEXT_MIME_TYPES.has(mime) || mime.startsWith('text/');
}

/**
 * Find a notebook document by URI string, or return the active notebook.
 */
function resolveNotebook(notebookUri?: string): vscode.NotebookDocument {
    if (notebookUri) {
        const uri = vscode.Uri.parse(notebookUri);
        const doc = vscode.workspace.notebookDocuments.find(
            nb => nb.uri.toString() === uri.toString()
        );
        if (!doc) {
            throw new Error(
                `Notebook not found: ${notebookUri}\n` +
                `Open notebooks: ${vscode.workspace.notebookDocuments.map(d => d.uri.toString()).join(', ') || '(none)'}`
            );
        }
        return doc;
    }

    // Fall back to active notebook
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) {
        throw new Error(
            'No active notebook editor. Provide notebookUri explicitly, or open a notebook.'
        );
    }
    return editor.notebook;
}

/**
 * Extract text content from a cell's outputs.
 */
function extractCellOutputText(cell: vscode.NotebookCell, maxChars: number): string {
    const parts: string[] = [];
    let totalChars = 0;

    for (const output of cell.outputs) {
        for (const item of output.items) {
            if (isTextMime(item.mime)) {
                const text = new TextDecoder().decode(item.data);
                const remaining = maxChars - totalChars;
                if (remaining <= 0) {
                    parts.push(`\n... truncated at ${maxChars} characters`);
                    return parts.join('');
                }
                if (text.length > remaining) {
                    parts.push(text.slice(0, remaining));
                    parts.push(`\n... truncated at ${maxChars} characters`);
                    return parts.join('');
                }
                parts.push(text);
                totalChars += text.length;
            } else if (item.mime.startsWith('image/')) {
                parts.push(`[image: ${item.mime}, ${item.data.byteLength} bytes]\n`);
            }
            // Skip other binary mime types silently
        }
    }

    if (parts.length === 0) {
        return '(no text output)';
    }
    return parts.join('');
}

// ---------------------------------------------------------------------------
// Tool: aicReadLiveCellOutput
// ---------------------------------------------------------------------------

interface ReadCellInput {
    cellNumber: number;
    notebookUri?: string;
    maxCharacters?: number;
}

class ReadLiveCellOutputTool implements vscode.LanguageModelTool<ReadCellInput> {

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ReadCellInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { cellNumber, notebookUri, maxCharacters } = options.input;
        const maxChars = maxCharacters ?? 200_000;

        const notebook = resolveNotebook(notebookUri);
        const cells = notebook.getCells();
        const totalCells = cells.length;

        if (cellNumber < 1 || cellNumber > totalCells) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Error: cellNumber ${cellNumber} out of range. Notebook has ${totalCells} cells (1-based).`
                )
            ]);
        }

        const cell = cells[cellNumber - 1];
        const kind = cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown';
        const execCount = cell.executionSummary?.executionOrder;

        let header = `Cell ${cellNumber} (${kind})`;
        if (execCount !== undefined) {
            header += ` [${execCount}]`;
        }
        header += `\n`;

        if (cell.outputs.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(header + '(no outputs)')
            ]);
        }

        const text = extractCellOutputText(cell, maxChars);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(header + text)
        ]);
    }
}

// ---------------------------------------------------------------------------
// Tool: aicListNotebookCells
// ---------------------------------------------------------------------------

interface ListCellsInput {
    notebookUri?: string;
}

class ListNotebookCellsTool implements vscode.LanguageModelTool<ListCellsInput> {

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ListCellsInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { notebookUri } = options.input;
        const notebook = resolveNotebook(notebookUri);
        const cells = notebook.getCells();

        const lines: string[] = [
            `Notebook: ${notebook.uri.fsPath}`,
            `Cells: ${cells.length}`,
            ''
        ];

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const kind = cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'md';
            const execCount = cell.executionSummary?.executionOrder;
            const execLabel = execCount !== undefined ? `[${execCount}]` : '[ ]';

            // Source preview: first line, truncated
            const firstLine = cell.document.getText().split('\n')[0];
            const preview = firstLine.length > 80
                ? firstLine.slice(0, 77) + '...'
                : firstLine;

            // Output summary
            const mimes = new Set<string>();
            for (const output of cell.outputs) {
                for (const item of output.items) {
                    mimes.add(item.mime);
                }
            }
            const outputInfo = mimes.size > 0
                ? `  outputs: ${[...mimes].join(', ')}`
                : '';

            lines.push(`  ${i + 1}. ${kind} ${execLabel} ${preview}${outputInfo}`);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(lines.join('\n'))
        ]);
    }
}

// ---------------------------------------------------------------------------
// Tool: aicKernelEval
// ---------------------------------------------------------------------------
//
// Read-only-by-convention expression evaluator that talks to the live
// notebook kernel via the Jupyter extension's kernels API.  The contract
// is "send an expression, get its repr back" — the same thing you would
// type at a REPL.  See ai-context-vscode issue #1.
//
// The Jupyter extension (ms-toolsai.jupyter) must be installed and a
// kernel must already be running for the target notebook (i.e. the user
// has executed at least one cell in this session).
//
// Behavior on busy kernel: returns `{ kernel_busy: true }` without
// queuing.  Jupyter kernels are single-threaded for code execution, so
// queuing a probe behind a multi-hour cell would defeat the purpose.

interface KernelEvalInput {
    expression: string;
    notebookUri?: string;
    timeoutMs?: number;
    maxCharacters?: number;
}

async function getJupyterKernelsApi(): Promise<any | undefined> {
    const ext = vscode.extensions.getExtension('ms-toolsai.jupyter');
    if (!ext) return undefined;
    if (!ext.isActive) {
        await ext.activate();
    }
    return ext.exports;
}

function jsonResult(payload: object): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(payload, null, 2))
    ]);
}

class KernelEvalTool implements vscode.LanguageModelTool<KernelEvalInput> {

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<KernelEvalInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { expression, notebookUri, timeoutMs, maxCharacters } = options.input;
        if (!expression || typeof expression !== 'string') {
            return jsonResult({ ok: false, error: 'expression is required (non-empty string).' });
        }
        const maxChars = maxCharacters ?? 8192;
        const timeout = Math.max(100, timeoutMs ?? 5000);

        let notebook: vscode.NotebookDocument;
        try {
            notebook = resolveNotebook(notebookUri);
        } catch (e: any) {
            return jsonResult({ ok: false, error: String(e?.message ?? e) });
        }

        const api = await getJupyterKernelsApi();
        if (!api?.kernels?.getKernel) {
            return jsonResult({
                ok: false,
                error: 'Jupyter extension (ms-toolsai.jupyter) is not installed or does not expose kernels.getKernel.'
            });
        }

        let kernel: any;
        try {
            kernel = await api.kernels.getKernel(notebook.uri);
        } catch (e: any) {
            return jsonResult({ ok: false, error: `getKernel failed: ${String(e?.message ?? e)}` });
        }
        if (!kernel) {
            return jsonResult({
                ok: false,
                error: 'No kernel for this notebook. Run a cell first to start the kernel.'
            });
        }

        const status = kernel.status ?? 'unknown';
        if (status === 'busy') {
            return jsonResult({
                ok: false,
                kernel_busy: true,
                status,
                error: 'Kernel is busy executing another cell. Refusing to queue.'
            });
        }
        if (status === 'dead' || status === 'terminating') {
            return jsonResult({ ok: false, status, error: `Kernel status is "${status}".` });
        }

        // Wrap the expression in repr() so we always get a string back.
        // The user contract is: "send an expression, not a statement".
        // Use a single line so callers can pass any expression they would
        // type at a REPL.  Errors (SyntaxError, NameError, etc.) surface
        // through the kernel's error output channel, captured below.
        const code = `print(repr((${expression})))`;

        const tokenSrc = new vscode.CancellationTokenSource();
        const timer = setTimeout(() => tokenSrc.cancel(), timeout);

        let stdout = '';
        let stderr = '';
        let errInfo: { ename?: string; evalue?: string } | undefined;
        let truncated = false;
        let timedOut = false;

        try {
            const stream: AsyncIterable<any> = kernel.executeCode(code, tokenSrc.token);
            for await (const output of stream) {
                const items = output?.items ?? output ?? [];
                for (const item of items) {
                    const mime: string = item.mime ?? '';
                    const data: Uint8Array = item.data;
                    if (!data) continue;
                    if (mime === 'application/vnd.code.notebook.error') {
                        try {
                            const parsed = JSON.parse(new TextDecoder().decode(data));
                            errInfo = { ename: parsed.name, evalue: parsed.message };
                            if (parsed.stack) stderr += String(parsed.stack);
                        } catch {
                            stderr += new TextDecoder().decode(data);
                        }
                        continue;
                    }
                    if (!isTextMime(mime)) continue;
                    const text = new TextDecoder().decode(data);
                    const target = mime === 'application/vnd.code.notebook.stderr' ? 'stderr' : 'stdout';
                    const cur = target === 'stderr' ? stderr : stdout;
                    const remaining = maxChars - (stdout.length + stderr.length);
                    if (remaining <= 0) {
                        truncated = true;
                        break;
                    }
                    const chunk = text.length > remaining ? text.slice(0, remaining) : text;
                    if (text.length > remaining) truncated = true;
                    if (target === 'stderr') stderr = cur + chunk; else stdout = cur + chunk;
                    if (truncated) break;
                }
                if (truncated) break;
            }
        } catch (e: any) {
            if (tokenSrc.token.isCancellationRequested) {
                timedOut = true;
            } else {
                return jsonResult({ ok: false, error: `executeCode failed: ${String(e?.message ?? e)}` });
            }
        } finally {
            clearTimeout(timer);
            tokenSrc.dispose();
        }

        if (timedOut) {
            return jsonResult({
                ok: false,
                error: `Evaluation timed out after ${timeout}ms.`,
                stdout_partial: stdout.trimEnd(),
                stderr_partial: stderr.trimEnd(),
            });
        }

        if (errInfo) {
            return jsonResult({
                ok: false,
                ename: errInfo.ename,
                evalue: errInfo.evalue,
                stderr: stderr.trimEnd() || undefined,
            });
        }

        return jsonResult({
            ok: true,
            kernel_busy: false,
            status,
            truncated,
            repr: stdout.trimEnd(),
            stderr: stderr ? stderr.trimEnd() : undefined,
        });
    }
}

// ---------------------------------------------------------------------------
// Tool: aicRunCellAsync
// ---------------------------------------------------------------------------
//
// Fire-and-forget notebook cell execution.  Unlike the built-in
// run_notebook_cell tool (which blocks until the cell finishes), this tool
// selects the target cell in the notebook editor and triggers execution
// without waiting for completion.  The invoke() returns immediately with
// {ok: true, started: true}, so the chat stays responsive during long runs.
//
// After starting, use aicListNotebookCells to check whether the execution
// count has incremented (indicating the cell finished), and
// aicReadLiveCellOutput to read its output.
//
// If the kernel is already running another cell, VS Code queues the new
// execution normally — same behaviour as clicking Run in the UI.

interface RunCellAsyncInput {
    cellNumber: number;
    notebookUri?: string;
}

class RunCellAsyncTool implements vscode.LanguageModelTool<RunCellAsyncInput> {

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RunCellAsyncInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { cellNumber, notebookUri } = options.input;

        let notebook: vscode.NotebookDocument;
        try {
            notebook = resolveNotebook(notebookUri);
        } catch (e: any) {
            return jsonResult({ ok: false, error: String(e?.message ?? e) });
        }

        const cells = notebook.getCells();
        if (cellNumber < 1 || cellNumber > cells.length) {
            return jsonResult({
                ok: false,
                error: `cellNumber ${cellNumber} out of range (1–${cells.length})`
            });
        }

        const cellIndex = cellNumber - 1;
        const cell = cells[cellIndex];

        if (cell.kind !== vscode.NotebookCellKind.Code) {
            return jsonResult({ ok: false, error: `Cell ${cellNumber} is a markdown cell — cannot execute.` });
        }

        // Find an already-open editor for this notebook, or reveal it.
        let editor = vscode.window.visibleNotebookEditors.find(
            e => e.notebook.uri.toString() === notebook.uri.toString()
        );
        if (!editor) {
            await vscode.commands.executeCommand('vscode.openWith', notebook.uri, 'jupyter-notebook');
            editor = vscode.window.activeNotebookEditor;
        }
        if (!editor) {
            return jsonResult({ ok: false, error: 'Could not open or find a notebook editor for this notebook.' });
        }

        // Select the target cell so notebook.cell.execute acts on it.
        editor.selections = [new vscode.NotebookRange(cellIndex, cellIndex + 1)];

        // Fire and forget — intentionally NOT awaited.
        // awaiting notebook.cell.execute would block until the cell finishes,
        // which defeats the purpose.  The Promise is deliberately dropped.
        void vscode.commands.executeCommand('notebook.cell.execute');

        const preview = cell.document.getText().split('\n')[0].slice(0, 60);
        return jsonResult({
            ok: true,
            started: true,
            cellNumber,
            preview,
            message: `Cell ${cellNumber} execution started (fire-and-forget). ` +
                     `Use aicListNotebookCells to check completion (execution count changes), ` +
                     `then aicReadLiveCellOutput to read the output.`
        });
    }
}

// ---------------------------------------------------------------------------
// AI Context Status Bar
// ---------------------------------------------------------------------------

function extractCurrentTask(statusMd: string): string {
    const lines = statusMd.split('\n');
    let inSection = false;
    for (const line of lines) {
        if (/^##\s.*Current Task/.test(line)) {
            inSection = true;
            continue;
        }
        if (inSection) {
            if (line.startsWith('##')) { break; }
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                return trimmed;
            }
        }
    }
    return '';
}

const DISMISS_COMMAND = 'ai-context-vscode.dismissStatusBar';

function showAiContextStatusBar(context: vscode.ExtensionContext): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }

    // Coordinator pattern (AI Context Standard v0.10.0):
    // If any workspace folder has WORKSPACE_STATUS.md, it is the coordinator.
    // Use only its current task. Fall back to PROJECT_STATUS.md scanning for
    // single-repo workspaces (backward compatible).
    const parts: string[] = [];

    const coordinatorFolder = folders.find(f =>
        fs.existsSync(path.join(f.uri.fsPath, 'WORKSPACE_STATUS.md'))
    );

    if (coordinatorFolder) {
        const wsFile = path.join(coordinatorFolder.uri.fsPath, 'WORKSPACE_STATUS.md');
        try {
            const content = fs.readFileSync(wsFile, 'utf8');
            const task = extractCurrentTask(content);
            parts.push(task ? task : coordinatorFolder.name);
        } catch {
            parts.push(coordinatorFolder.name);
        }
    } else {
        // Single-repo fallback: scan all folders for PROJECT_STATUS.md
        for (const folder of folders) {
            const statusFile = path.join(folder.uri.fsPath, 'PROJECT_STATUS.md');
            if (!fs.existsSync(statusFile)) { continue; }
            try {
                const content = fs.readFileSync(statusFile, 'utf8');
                const task = extractCurrentTask(content);
                parts.push(task ? `${folder.name} — ${task}` : folder.name);
            } catch {
                parts.push(folder.name);
            }
        }
    }

    if (parts.length === 0) { return; }

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    item.text = `$(check) AI Context: ${parts.join('  |  ')}`;
    item.tooltip = 'AI Context initialized. Click to dismiss.';
    item.command = DISMISS_COMMAND;
    item.show();

    const cmd = vscode.commands.registerCommand(DISMISS_COMMAND, () => item.hide());
    context.subscriptions.push(item, cmd);
}

// ---------------------------------------------------------------------------
// Shared helper: query whether any aic-active-* thread is alive in a kernel.
// Returns false (rather than throwing) on any failure so callers stay simple.
// ---------------------------------------------------------------------------

async function queryAicActiveWorker(notebookUri: vscode.Uri): Promise<boolean> {
    const api = await getJupyterKernelsApi();
    if (!api?.kernels?.getKernel) { return false; }
    const kernel = await api.kernels.getKernel(notebookUri);
    if (!kernel || kernel.status === 'dead' || kernel.status === 'terminating') { return false; }
    // Skip when busy — avoid queueing behind an active cell execution.
    if (kernel.status === 'busy') { return false; }
    const code =
        `print(repr(any(t.is_alive() for t in ` +
        `__import__('threading').enumerate() ` +
        `if t.name.startswith('aic-active-'))))` ;
    const tokenSrc = new vscode.CancellationTokenSource();
    const timer = setTimeout(() => tokenSrc.cancel(), 1500);
    let result = false;
    try {
        const stream: AsyncIterable<any> = kernel.executeCode(code, tokenSrc.token);
        for await (const output of stream) {
            const items = output?.items ?? output ?? [];
            for (const item of items) {
                if (isTextMime(item.mime ?? '') &&
                    new TextDecoder().decode(item.data).trim() === 'True') {
                    result = true;
                }
            }
        }
    } catch { /* timeout or kernel error → treat as no active worker */ }
    finally { clearTimeout(timer); tokenSrc.dispose(); }
    return result;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    // Defer version file updates so they don't run during notebook webview
    // initialization. Synchronous fs I/O during activate() can block the
    // event loop and cause notebook toolbars/content to fail to render.
    const timer = setTimeout(() => updateVersionFiles(), 5000);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });

    // Show AI Context status bar after a brief delay (after version files).
    const statusTimer = setTimeout(() => showAiContextStatusBar(context), 6000);
    context.subscriptions.push({ dispose: () => clearTimeout(statusTimer) });

    context.subscriptions.push(
        vscode.lm.registerTool('aicReadLiveCellOutput', new ReadLiveCellOutputTool()),
        vscode.lm.registerTool('aicListNotebookCells', new ListNotebookCellsTool()),
        vscode.lm.registerTool('aicKernelEval', new KernelEvalTool()),
        vscode.lm.registerTool('aicRunCellAsync', new RunCellAsyncTool()),
    );

    // Guarded "Clear All Outputs" command.
    // Before clearing, queries the kernel for any live threads whose name
    // starts with 'aic-active-'.  If found, shows a confirmation modal.
    // Falls through to the native command when the kernel is unavailable,
    // the query times out, or no active threads are found.
    const guardedClear = vscode.commands.registerCommand(
        'aic.clearAllOutputsGuarded',
        async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                await vscode.commands.executeCommand('notebook.clearAllCellsOutputs');
                return;
            }

            let hasActiveWorker = false;
            try {
                hasActiveWorker = await queryAicActiveWorker(editor.notebook.uri);
            } catch {
                // Kernel unavailable or query failed — proceed without guard.
            }

            if (hasActiveWorker) {
                const choice = await vscode.window.showWarningMessage(
                    'A background task (aic-active-*) is running in this kernel. ' +
                    'Clearing outputs will not stop it, but the results will be lost. ' +
                    'Clear anyway?',
                    { modal: true },
                    'Clear',
                );
                if (choice !== 'Clear') { return; }
            }

            await vscode.commands.executeCommand('notebook.clearAllCellsOutputs');
        }
    );
    context.subscriptions.push(guardedClear);

    // Poll the active notebook every 5 seconds to keep the 'aic.hasActiveWorker'
    // context key current.  The toolbar 'when' clause uses this key so the guarded
    // clear button appears only when an aic-active-* thread is actually running,
    // and disappears automatically once the job finishes.
    let _pollInterval: ReturnType<typeof setInterval> | undefined;

    async function refreshAicWorkerContext(): Promise<void> {
        const editor = vscode.window.activeNotebookEditor;
        let hasActive = false;
        if (editor) {
            try { hasActive = await queryAicActiveWorker(editor.notebook.uri); } catch { /* ignore */ }
        }
        vscode.commands.executeCommand('setContext', 'aic.hasActiveWorker', hasActive);
    }

    vscode.commands.executeCommand('setContext', 'aic.hasActiveWorker', false);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveNotebookEditor(editor => {
            if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = undefined; }
            if (editor) {
                refreshAicWorkerContext();
                _pollInterval = setInterval(refreshAicWorkerContext, 5000);
            } else {
                vscode.commands.executeCommand('setContext', 'aic.hasActiveWorker', false);
            }
        })
    );
    context.subscriptions.push({ dispose: () => { if (_pollInterval) { clearInterval(_pollInterval); } } });

    // Probe any notebook that is already active when the extension activates.
    refreshAicWorkerContext();
    if (vscode.window.activeNotebookEditor) {
        _pollInterval = setInterval(refreshAicWorkerContext, 5000);
    }
}

export function deactivate() {}
