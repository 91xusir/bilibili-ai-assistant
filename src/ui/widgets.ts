import { el } from "./common";

/** 开关行 (Popup / Options 共用; 即时回调, 无内部状态). */
export function buildSwitchRow(
    label: string,
    desc: string,
    initial: boolean,
    onChange: (value: boolean) => void,
): HTMLElement {
    const row = el("div", "bia-switch-row");
    const text = el("div", "bia-switch-text");
    text.appendChild(el("span", "bia-switch-label", label));
    if (desc) text.appendChild(el("span", "bia-switch-desc", desc));
    const button = el("button", "bia-switch") as HTMLButtonElement;
    button.type = "button";
    button.setAttribute("role", "switch");
    button.appendChild(el("span", "bia-switch-knob"));
    const render = () =>
        button.classList.toggle("bia-on", button.dataset.on === "1");
    button.dataset.on = initial ? "1" : "0";
    render();
    button.addEventListener("click", () => {
        button.dataset.on = button.dataset.on === "1" ? "0" : "1";
        render();
        onChange(button.dataset.on === "1");
    });
    row.append(text, button);
    return row;
}

/** 双选项分段选择 (如 点击文本: 跳转/复制). */
export function buildSegmentRow<T extends string>(
    label: string,
    desc: string,
    options: { value: T; text: string }[],
    initial: T,
    onChange: (value: T) => void,
): HTMLElement {
    const row = el("div", "bia-switch-row");
    const text = el("div", "bia-switch-text");
    text.appendChild(el("span", "bia-switch-label", label));
    if (desc) text.appendChild(el("span", "bia-switch-desc", desc));
    const group = el("div", "bia-segment");
    let current = initial;
    const buttons = options.map((option) => {
        const button = el(
            "button",
            "bia-segment-btn",
            option.text,
        ) as HTMLButtonElement;
        button.type = "button";
        button.dataset.value = option.value;
        button.addEventListener("click", () => {
            current = option.value;
            render();
            onChange(option.value);
        });
        group.appendChild(button);
        return button;
    });
    const render = () => {
        for (const button of buttons) {
            button.classList.toggle("bia-active", button.dataset.value === current);
        }
    };
    render();
    row.append(text, group);
    return row;
}
