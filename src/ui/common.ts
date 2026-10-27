export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export type Phase = "loading" | "error" | "none" | "ready";

export function renderLoading(root: HTMLElement, text: string): void {
    const wrap = el("div", "bia-loading");
    wrap.appendChild(el("div", "bia-spinner"));
    wrap.appendChild(el("div", undefined, text));
    root.appendChild(wrap);
}

export function renderPhaseBlock(
    root: HTMLElement,
    phase: Phase,
    message: string,
): void {
    if (phase === "loading") {
        renderLoading(root, message);
        return;
    }
    if (phase === "error") {
        root.appendChild(el("div", "bia-error", message));
        return;
    }
    root.appendChild(el("div", "bia-placeholder", message));
}

export function renderTaskIdle(
    root: HTMLElement,
    aiConfigured: boolean,
    actionText: string,
): void {
    if (aiConfigured) {
        root.appendChild(
            el("div", "bia-placeholder", `点击右下角 ⟳ 按钮${actionText}`),
        );
    } else {
        root.appendChild(
            el(
                "div",
                "bia-placeholder",
                "未配置 AI 接口\n\n点击「设置」标签页\n填写 OpenAI 兼容接口地址与模型名",
            ),
        );
    }
}

export function renderTaskError(root: HTMLElement, error: string): void {
    root.appendChild(el("div", "bia-error", error));
    root.appendChild(el("div", "bia-retry-hint", "点击右下角 ⟳ 按钮重试"));
}

export function renderTaskDisabled(root: HTMLElement, text: string): void {
    root.appendChild(el("div", "bia-placeholder", text));
}
