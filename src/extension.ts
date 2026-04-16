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
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    updateVersionFiles();
    context.subscriptions.push(
        vscode.lm.registerTool('aicReadLiveCellOutput', new ReadLiveCellOutputTool()),
        vscode.lm.registerTool('aicListNotebookCells', new ListNotebookCellsTool())
    );
}

export function deactivate() {}
