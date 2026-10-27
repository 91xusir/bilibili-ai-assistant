import type { MindmapNode, MindmapResult } from "../ai/mindmap";
import { formatTime } from "../subtitle";
import type { SubtitleDoc, TaskState } from "../types";
import { exportMindmapFile } from "./exporters";
import {
    el,
    renderLoading,
    renderPhaseBlock,
    renderTaskDisabled,
    renderTaskError,
    renderTaskIdle,
    type Phase,
} from "./common";

export interface MindmapViewProps {
    phase: Phase;
    phaseMessage: string;
    task: TaskState;
    aiConfigured: boolean;
    doc: SubtitleDoc | null;
    mindmap: MindmapResult | null;
    onSeek: (time: number) => void;
}

/** 第 3 层及更深的节点默认折叠. */
const COLLAPSE_DEPTH = 2;

function buildNode(
    node: MindmapNode,
    depth: number,
    onSeek: (time: number) => void,
): HTMLElement {
    const li = el("li");
    const row = el("div", "bia-mm-row");
    const hasChildren = Boolean(node.children?.length);
    let caret: HTMLElement | null = null;

    if (hasChildren) {
        caret = el("span", "bia-mm-caret", "▾");
        row.appendChild(caret);
    } else {
        row.appendChild(el("span", "bia-mm-caret"));
    }
    row.appendChild(el("span", "bia-mm-title", node.title));
    if (node.start !== undefined) {
        const badge = el("span", "bia-time-badge", formatTime(node.start));
        badge.addEventListener("click", (event) => {
            event.stopPropagation();
            onSeek(node.start!);
        });
        row.appendChild(badge);
    }

    const toggle = () => {
        const collapsed = li.classList.toggle("bia-mm-collapsed");
        if (caret) caret.textContent = collapsed ? "▸" : "▾";
    };
    if (caret) {
        caret.addEventListener("click", (event) => {
            event.stopPropagation();
            toggle();
        });
        row.addEventListener("click", toggle);
    }

    li.appendChild(row);
    if (hasChildren && node.children) {
        const list = el("ul");
        for (const child of node.children) {
            list.appendChild(buildNode(child, depth + 1, onSeek));
        }
        li.appendChild(list);
        if (depth >= COLLAPSE_DEPTH) {
            li.classList.add("bia-mm-collapsed");
            caret!.textContent = "▸";
        }
    }
    return li;
}

export function renderMindmapView(
    root: HTMLElement,
    props: MindmapViewProps,
): void {
    root.innerHTML = "";
    if (props.phase !== "ready") {
        renderPhaseBlock(root, props.phase, props.phaseMessage);
        return;
    }
    if (!props.mindmap) {
        if (props.task.status === "loading") {
            renderLoading(root, "AI 正在生成思维导图...");
        } else if (props.task.status === "error") {
            renderTaskError(root, props.task.error ?? "AI 思维导图生成失败");
        } else if (props.task.status === "disabled") {
            renderTaskDisabled(root, "已在「设置」中关闭「生成思维导图」");
        } else {
            renderTaskIdle(root, props.aiConfigured, "生成 AI 思维导图");
        }
        return;
    }

    if (props.doc) {
        const exportRow = el("div", "bia-export-row");
        const exportButton = el(
            "button",
            "bia-export-btn",
            "⤓ 导出 Markdown",
        ) as HTMLButtonElement;
        exportButton.type = "button";
        exportButton.addEventListener("click", () => {
            if (props.doc) {
                exportMindmapFile(props.doc, {
                    title: props.mindmap!.title,
                    children: props.mindmap!.children,
                });
            }
        });
        exportRow.appendChild(exportButton);
        root.appendChild(exportRow);
    }

    const wrap = el("div", "bia-mm");
    const rootRow = el("div", "bia-mm-root");
    rootRow.appendChild(el("span", undefined, props.mindmap.title));
    wrap.appendChild(rootRow);

    const list = el("ul");
    for (const child of props.mindmap.children) {
        list.appendChild(buildNode(child, 0, props.onSeek));
    }
    wrap.appendChild(list);
    root.appendChild(wrap);

    if (props.task.status === "loading") {
        root.appendChild(
            el("div", "bia-generating", "▍ AI 正在生成, 节点将逐步显示..."),
        );
    }
}
