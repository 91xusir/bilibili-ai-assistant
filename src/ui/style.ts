import { injectStyle } from "../core/storage";

const STYLE = `
.bia-panel {
  --bia-bg: #1b1b1b;
  --bia-bg-2: #252525;
  --bia-bg-3: #303030;
  --bia-border: #3a3a3a;
  --bia-text: #e3e5e7;
  --bia-text-2: #9499a0;
  --bia-accent: #00caca;
  --bia-accent-dim: rgba(0, 202, 202, 0.14);
  --bia-danger: #ff5c5c;
  /* 宽度由 JS 跟随视频选集容器; 高度固定 */
  width: var(--bia-panel-width, 411px);
  height: 380px;
  position: relative;
  /* B站把右侧栏容器设为 pointer-events:none, 必须显式恢复, 否则整个面板点击穿透 */
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin-bottom: 12px;
  background: var(--bia-bg);
  color: var(--bia-text);
  font-size: 13px;
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  text-align: left;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
  z-index: 1;
}
.bia-panel *, .bia-panel *::before, .bia-panel *::after { box-sizing: border-box; }

/* 浅色主题 (跟随 B站浅色模式) */
.bia-panel[data-theme="light"] {
  --bia-bg: #ffffff;
  --bia-bg-2: #f6f7f8;
  --bia-bg-3: #e3e5e7;
  --bia-border: #e3e5e7;
  --bia-text: #18191c;
  --bia-text-2: #61666d;
  --bia-accent: #00a1d6;
  --bia-accent-dim: rgba(0, 161, 214, 0.12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.bia-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 8px 0 4px;
  background: var(--bia-bg-2);
  border-bottom: 1px solid var(--bia-border);
}
.bia-tabs { display: flex; height: 100%; gap: 2px; }
.bia-tab {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--bia-text-2);
  font-size: 13px;
  font-family: inherit;
  padding: 0 12px;
  height: 100%;
  cursor: pointer;
  position: relative;
}
.bia-tab:hover { color: var(--bia-text); }
.bia-tab.bia-active { color: var(--bia-accent); font-weight: 600; }
.bia-tab.bia-active::after {
  content: "";
  position: absolute;
  left: 10px; right: 10px; bottom: 0;
  height: 2px;
  background: var(--bia-accent);
  border-radius: 2px 2px 0 0;
}
.bia-actions { display: flex; align-items: center; gap: 2px; }
.bia-icon-btn {
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent;
  color: var(--bia-text-2);
  cursor: pointer; border-radius: 4px; padding: 0;
}
.bia-icon-btn:hover { background: var(--bia-bg-3); color: var(--bia-text); }
.bia-icon-btn svg { width: 16px; height: 16px; fill: currentColor; }
.bia-icon-btn.bia-on { color: var(--bia-accent); }

.bia-body { flex: 1; overflow-y: auto; overflow-x: hidden; }
.bia-body::-webkit-scrollbar { width: 8px; }
.bia-body::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }
.bia-body::-webkit-scrollbar-thumb:hover { background: #4a4a4a; }
.bia-view { display: none; padding: 10px; }
.bia-view.bia-active { display: block; }

.bia-placeholder {
  color: var(--bia-text-2);
  text-align: center;
  padding: 48px 20px;
  line-height: 1.9;
  white-space: pre-line;
}
.bia-loading {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 52px 16px;
  color: var(--bia-text-2);
}
.bia-spinner {
  width: 28px; height: 28px;
  border: 3px solid var(--bia-bg-3);
  border-top-color: var(--bia-accent);
  border-radius: 50%;
  animation: bia-spin 0.9s linear infinite;
}
@keyframes bia-spin { to { transform: rotate(360deg); } }
.bia-error {
  background: rgba(255, 92, 92, 0.1);
  border: 1px solid rgba(255, 92, 92, 0.4);
  color: #ff8080;
  padding: 10px 12px;
  border-radius: 6px;
  margin: 8px 0;
  line-height: 1.6;
  word-break: break-all;
}
.bia-retry-hint { color: var(--bia-text-2); font-size: 12px; margin-top: 8px; text-align: center; }

/* ---- 视频总结 ---- */
.bia-overview {
  background: var(--bia-bg-2);
  border: 1px solid var(--bia-border);
  border-radius: 6px;
  padding: 10px 12px;
  line-height: 1.7;
  margin-bottom: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.bia-section {
  padding: 10px 8px;
  border-radius: 6px;
  cursor: pointer;
  border-left: 2px solid transparent;
}
.bia-section:hover { background: var(--bia-bg-2); }
.bia-section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.bia-section-title { font-weight: 600; min-width: 0; }
.bia-section-content {
  color: var(--bia-text-2);
  line-height: 1.65;
  font-size: 12.5px;
  overflow-wrap: anywhere;
}
.bia-time-badge {
  display: inline-block;
  background: var(--bia-accent-dim);
  color: var(--bia-accent);
  font-size: 11px;
  font-family: Consolas, "Courier New", monospace;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
  cursor: pointer;
  white-space: nowrap;
}
.bia-section:hover .bia-time-badge { background: var(--bia-accent); color: #102020; }

/* ---- 时间轴 ---- */
.bia-tl-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  border-left: 2px solid transparent;
  line-height: 1.6;
}
.bia-tl-row:hover { background: var(--bia-bg-2); }
.bia-tl-time {
  color: var(--bia-accent);
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
  flex-shrink: 0;
  padding-top: 1px;
}
.bia-tl-content { flex: 1; min-width: 0; font-size: 12.5px; overflow-wrap: anywhere; }
.bia-tl-current { background: var(--bia-accent-dim); border-left-color: var(--bia-accent); }
.bia-tl-current .bia-tl-content { color: var(--bia-accent); }
.bia-tl-ad-row .bia-tl-content { color: var(--bia-text-2); }
.bia-tl-ad-tag {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--bia-danger);
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
  height: 16px;
  line-height: 15px;
  cursor: help;
}
.bia-tl-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.bia-tl-status { font-size: 11.5px; color: var(--bia-text-2); min-width: 0; }

/* ---- 广告确认横幅 ---- */
.bia-ad-banner {
  display: none;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  background: rgba(255, 176, 32, 0.12);
  border-bottom: 1px solid rgba(255, 176, 32, 0.45);
  color: var(--bia-text);
  font-size: 12.5px;
}
.bia-ad-banner.bia-show { display: flex; }
.bia-ad-banner-text { flex: 1; min-width: 0; }
.bia-ad-banner-skip {
  flex-shrink: 0;
  padding: 2px 12px;
  font-size: 12px;
  background: var(--bia-accent);
  border-color: var(--bia-accent);
  color: #102020;
  font-weight: 600;
}

.bia-btn {
  padding: 5px 14px;
  border-radius: 4px;
  border: 1px solid var(--bia-border);
  background: var(--bia-bg-3);
  color: var(--bia-text);
  cursor: pointer;
  font-size: 12.5px;
  font-family: inherit;
}
.bia-btn:hover { filter: brightness(1.15); }
.bia-statusbar {
  flex-shrink: 0;
  display: none;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 10px;
  background: var(--bia-bg-2);
  border-top: 1px solid var(--bia-border);
  color: var(--bia-text-2);
  font-size: 11.5px;
  overflow: hidden;
  white-space: nowrap;
}
.bia-statusbar.bia-show { display: flex; }
.bia-spinner.bia-sm { width: 12px; height: 12px; border-width: 2px; }

/* ---- 右下角悬浮按钮组 (导出 + 重新生成) ---- */
.bia-fab-stack {
  position: absolute;
  right: 12px; bottom: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: bottom 0.2s;
}
.bia-fab {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--bia-border);
  border-radius: 50%;
  background: var(--bia-bg-3);
  color: var(--bia-text);
  cursor: pointer;
  padding: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s;
}
.bia-fab:hover:not(:disabled) {
  background: var(--bia-accent);
  border-color: var(--bia-accent);
  color: #102020;
}
.bia-fab:disabled { opacity: 0.55; cursor: default; }
.bia-fab svg { width: 17px; height: 17px; fill: currentColor; }
.bia-fab-stack.bia-above-bar { bottom: 36px; }
.bia-fab.bia-spinning svg { animation: bia-spin 1s linear infinite; }

/* 导出菜单: Popover API (顶层渲染, 不受面板 overflow 裁剪) + 隐式锚点定位 */
.bia-export-wrap { display: contents; }
.bia-export-menu {
  inset: auto;
  position-area: block-start span-inline-end;
  margin: 0 0 8px 0;
  border: 1px solid var(--bia-border);
  border-radius: 6px;
  padding: 4px;
  background: var(--bia-bg);
  color: var(--bia-text);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
  min-width: 150px;
}
.bia-export-menu-inner { display: flex; flex-direction: column; }
.bia-export-item {
  border: none;
  background: transparent;
  color: var(--bia-text);
  text-align: left;
  font-size: 12.5px;
  font-family: inherit;
  padding: 7px 10px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.bia-export-item:hover:not(:disabled) { background: var(--bia-bg-3); }
.bia-export-item:disabled { color: var(--bia-text-2); cursor: default; opacity: 0.6; }

.bia-generating {
  color: var(--bia-accent);
  font-size: 12px;
  padding: 8px;
  animation: bia-pulse 1.2s ease-in-out infinite;
}
@keyframes bia-pulse { 50% { opacity: 0.35; } }
.bia-test-fail { color: #ff8080; }

/* ---- Toast ---- */
.bia-toast-wrap {
  position: fixed;
  top: 64px; left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none;
}
.bia-toast {
  background: rgba(20, 20, 20, 0.95);
  color: #eee;
  border: 1px solid #3a3a3a;
  border-left: 3px solid #00caca;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 0.25s, transform 0.25s;
  max-width: 70vw;
}
.bia-toast-show { opacity: 1; transform: translateY(0); }
.bia-toast-warn { border-left-color: #ffb020; }
.bia-toast-error { border-left-color: #ff5c5c; }
`;

export function injectStyles(): void {
    injectStyle(STYLE);
}
