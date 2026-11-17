import * as core from './core';

export const packageActions = new Set(['add', 'edit', 'delete', 'resolve', 'refresh']);
export function packagesHtml(nonce: string, title: string, packages: core.PackageDependency[]): string {
  const esc = core.escapeHtml;
  const rows = packages
    .map(
      (p) => `<tr>
      <td><strong>${esc(p.name)}</strong><div class="muted">${esc(p.url || p.path)}</div></td>
      <td>${esc(core.requirementLabel(p.requirement))}</td>
      <td>${p.products.map((x) => `${esc(x.name)} <span class="muted">→ ${esc(x.targets.join(', ') || 'no target')}</span>`).join('<br>') || '<span class="muted">None</span>'}</td>
      <td class="row-actions">${p.url ? `<button class="secondary" data-action="edit" data-id="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">Edit</button>` : ''}<button class="secondary" data-action="delete" data-id="${esc(p.id)}" aria-label="Delete ${esc(p.name)}">Delete</button></td>
    </tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
  body{margin:0;padding:24px;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}
  h1{font-size:20px;margin:0 0 4px}p,.muted{color:var(--vscode-descriptionForeground)}.muted{font-size:11px;overflow-wrap:anywhere}
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
  button{font:inherit;cursor:pointer;border:1px solid transparent;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border-radius:4px;padding:6px 12px}button:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
  .secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
  table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--vscode-descriptionForeground);padding:8px}td{padding:10px 8px;border-top:1px solid var(--vscode-widget-border,var(--vscode-panel-border));vertical-align:top}
  .row-actions{white-space:nowrap;text-align:right}.row-actions button{margin-left:6px}
  </style></head><body>
  <h1>Package Dependencies</h1><p>${esc(title)}</p>
  <div class="toolbar"><button data-action="add">Add package</button><button class="secondary" data-action="resolve">Resolve packages</button><button class="secondary" data-action="refresh">Refresh</button></div>
  ${packages.length ? `<table><thead><tr><th>Package</th><th>Version rule</th><th>Products → targets</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No Swift package dependencies in this project.</p>'}
  <p class="muted">Changes are written to project.pbxproj. Run Resolve packages to update Package.resolved. Close the project in Xcode first, or Xcode may overwrite these edits.</p>
  <script nonce="${nonce}">
  const vscode=acquireVsCodeApi();
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({action:b.dataset.action,id:b.dataset.id})));
  </script></body></html>`;
}
