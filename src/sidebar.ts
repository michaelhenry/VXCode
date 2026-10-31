import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
const allowed = new Set([
  'selectProject',
  'selectScheme',
  'selectSimulator',
  'build',
  'run',
  'test',
  'cancel',
  'showOutput',
]);
export class Sidebar {
  private view: any;
  private state: () => any;

  constructor(_context: any, state: () => any) {
    this.state = state;
  }
  resolveWebviewView(view: any): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const nonce = crypto.randomBytes(24).toString('base64');
    view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
    *{box-sizing:border-box}body{margin:0;padding:20px 14px;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}
    .eyebrow{font-size:10px;letter-spacing:1.8px;font-weight:700;color:var(--vscode-descriptionForeground)}h1{font-size:23px;letter-spacing:-.6px;margin:7px 0}p{line-height:1.6;color:var(--vscode-descriptionForeground);margin:0 0 20px}
    .status{display:flex;gap:8px;align-items:center;padding:10px 0 18px;font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:var(--vscode-testing-iconPassed)}.busy .dot{background:var(--vscode-progressBar-background);animation:pulse 1s infinite alternate}.error .dot{background:var(--vscode-errorForeground)}@keyframes pulse{to{opacity:.3}}
    h2{font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:var(--vscode-descriptionForeground);margin:8px 0 12px}
    button{font:inherit;cursor:pointer;border:1px solid transparent;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border-radius:5px;padding:10px 12px;min-height:36px}button:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}button:disabled{opacity:.45;cursor:default}
    .selector{display:block;width:100%;text-align:left;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-widget-border,transparent);margin:0 0 8px;padding:11px 12px}.selector:hover{background:var(--vscode-list-hoverBackground)}.label{display:block;font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:5px}.value{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chevron{float:right;color:var(--vscode-descriptionForeground)}
    .actions{display:grid;gap:8px;margin:20px 0}.primary{font-weight:600}.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}.footer{border-top:1px solid var(--vscode-widget-border,var(--vscode-panel-border));padding-top:16px;margin-top:20px}.text{background:transparent;color:var(--vscode-textLink-foreground);padding:5px 0;min-height:26px}.text:hover{background:transparent;text-decoration:underline}.hint{font-size:11px;line-height:1.6;margin-top:14px}#error{color:var(--vscode-errorForeground);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}
    </style></head><body>
    <div class="eyebrow">VXCODE</div><h1> Build and Run</h1><p>iOS apps directly from VS Code.</p>
    <div class="status" id="status" role="status" aria-live="polite"><span class="dot"></span><span id="statusText">Ready</span></div>
    <h2>Launch setup</h2>
    <button class="selector" data-action="selectProject"><span class="label">PROJECT / WORKSPACE <span class="chevron">›</span></span><span class="value" id="project">Choose a project…</span></button>
    <button class="selector" data-action="selectScheme"><span class="label">SCHEME <span class="chevron">›</span></span><span class="value" id="scheme">Choose a scheme…</span></button>
    <button class="selector" data-action="selectSimulator"><span class="label">SIMULATOR <span class="chevron">›</span></span><span class="value" id="device">Choose a simulator…</span></button>
    <div class="hint" id="configuration"></div><div class="actions"><button class="primary" data-action="run">▶ &nbsp; Build &amp; Run</button><button class="secondary" data-action="build">Build only</button><button class="secondary" data-action="test">Run tests</button><button class="secondary" data-action="cancel" id="cancel" hidden>Cancel operation</button></div>
    <div id="error" role="alert"></div><div class="footer"><button class="text" data-action="showOutput">Open build output ↗</button><p class="hint">Uses Xcode tools on this Mac.<br>Apps open in Apple's Simulator.</p></div>
    <script nonce="${nonce}">
    const vscode=acquireVsCodeApi();
    document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({action:button.dataset.action})));
    window.addEventListener('message',({data:s})=>{
      for(const key of ['project','scheme','device']){const el=document.getElementById(key);el.textContent=s[key]||({project:'Choose a project…',scheme:'Choose a scheme…',device:'Choose a simulator…'}[key]);el.title=s[key+'Detail']||s[key]||'';}
      document.getElementById('configuration').textContent=s.configuration+' · iOS Simulator';
      document.getElementById('statusText').textContent=s.status;
      document.getElementById('status').className='status'+(s.busy?' busy':s.error?' error':'');
      document.getElementById('error').textContent=s.error||'';
      document.getElementById('cancel').hidden=!s.busy;
      document.querySelectorAll('[data-action]').forEach(b=>b.disabled=s.busy&&!['cancel','showOutput'].includes(b.dataset.action));
    });vscode.postMessage({action:'ready'});
    </script></body></html>`;
    const listener = view.webview.onDidReceiveMessage((message) => {
      if (message?.action === 'ready') this.refresh();
      else if (allowed.has(message?.action)) void vscode.commands.executeCommand(`VXCode.${message.action}`);
    });
    const visibility = view.onDidChangeVisibility(() => this.refresh());
    view.onDidDispose(() => {
      listener.dispose();
      visibility.dispose();
      if (this.view === view) this.view = undefined;
    });
    this.refresh();
  }
  refresh(): void {
    const s = this.state();
    if (this.view)
      void this.view.webview.postMessage({
        ...s,
        project: s.project && path.basename(s.project),
        projectDetail: s.project,
        device: s.device?.name,
        deviceDetail: s.device && `${s.device.runtime} · ${s.device.udid}`,
      });
  }
}
