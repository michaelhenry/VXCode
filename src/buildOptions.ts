import * as core from './core';

export const buildOptionActions = new Set(['toggle', 'all', 'none', 'saveTests', 'saveArguments']);
export interface BuildOptionsState {
  optimizations: string[];
  onlyTesting: string[];
  additionalArguments: string[];
  preview: string[];
}
export function buildOptionsHtml(nonce: string, state: BuildOptionsState): string {
  const esc = core.escapeHtml;
  const selected = new Set(state.optimizations);
  const rows = core.buildOptimizations
    .map(
      (
        o,
      ) => `<label class="option"><input type="checkbox" data-id="${esc(o.id)}"${selected.has(o.id) ? ' checked' : ''}>
      <span><strong>${esc(o.label)}</strong>${o.testOnly ? ' <span class="tag">Tests</span>' : ''}<span class="muted">${esc(o.detail)}</span></span></label>`,
    )
    .join('');
  const preview = state.preview.map((a) => esc(JSON.stringify(a))).join(' ');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
  *{box-sizing:border-box}body{margin:0;padding:24px;max-width:760px;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--vscode-descriptionForeground);margin:28px 0 10px}
  p,.muted{color:var(--vscode-descriptionForeground)}.muted{display:block;font-size:11px;margin-top:3px;line-height:1.5;overflow-wrap:anywhere}
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
  button{font:inherit;cursor:pointer;border:1px solid transparent;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border-radius:4px;padding:6px 12px}button:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
  .secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
  .option{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--vscode-widget-border,var(--vscode-panel-border));cursor:pointer}.option input{margin-top:3px}
  .tag{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
  textarea{width:100%;min-height:84px;font-family:var(--vscode-editor-font-family);font-size:12px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-widget-border,transparent));border-radius:4px;padding:8px;resize:vertical}
  code{font-family:var(--vscode-editor-font-family);font-size:12px;overflow-wrap:anywhere}
  .preview{padding:10px;border-radius:4px;background:var(--vscode-textCodeBlock-background)}
  </style></head><body>
  <h1>Build Options</h1><p>Applied to Build, Build &amp; Run, Run tests and Clean. Archives are not affected. Saved in workspace settings.</p>
  <h2>Speedups</h2>
  <div class="toolbar"><button class="secondary" data-action="all">Turn on all</button><button class="secondary" data-action="none">Turn off all</button></div>
  ${rows}
  <h2>Tests to run</h2>
  <p>Leave empty to run the whole scheme. One per line: <code>Target</code>, <code>Target/Class</code> or <code>Target/Class/testMethod</code>.</p>
  <textarea id="tests" spellcheck="false" aria-label="Tests to run" placeholder="AppTests/LoginTests">${esc(state.onlyTesting.join('\n'))}</textarea>
  <div class="toolbar"><button data-action="saveTests">Save tests</button></div>
  <h2>Extra xcodebuild arguments</h2>
  <p>One argument per line, appended to every build and test.</p>
  <textarea id="arguments" spellcheck="false" aria-label="Extra xcodebuild arguments" placeholder="-jobs&#10;8">${esc(state.additionalArguments.join('\n'))}</textarea>
  <div class="toolbar"><button data-action="saveArguments">Save arguments</button></div>
  <h2>Added to a test run</h2>
  <div class="preview">${preview ? `<code>${preview}</code>` : '<span class="muted">Nothing; xcodebuild runs with the scheme defaults.</span>'}</div>
  <p class="muted">Use <strong>Re-run tests (skip build)</strong> in the Launch Center to run tests again without rebuilding after a test run.</p>
  <script nonce="${nonce}">
  const vscode=acquireVsCodeApi();
  document.querySelectorAll('input[type=checkbox]').forEach(c=>c.addEventListener('change',()=>vscode.postMessage({action:'toggle',id:c.dataset.id,checked:c.checked})));
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{
    const a=b.dataset.action;
    vscode.postMessage({action:a,text:a==='saveTests'?document.getElementById('tests').value:a==='saveArguments'?document.getElementById('arguments').value:undefined});
  }));
  </script></body></html>`;
}
