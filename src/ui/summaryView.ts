import { formatTime } from "../subtitle";
import type { SubtitleDoc, SummaryResult, TaskState } from "../types";
import { exportSummaryFile } from "./exporters";
import {
    el,
    renderLoading,
    renderPhaseBlock,
    renderTaskDisabled,
    renderTaskError,
    renderTaskIdle,
    type Phase,
} from "./common";

export interface SummaryViewProps {
    phase: Phase;
    phaseMessage: string;
    task: TaskState;
    aiConfigured: boolean;
    doc: SubtitleDoc | null;
    summary: SummaryResult | null;
    onSeek: (time: number) => void;
}

export function renderSummaryView(
    root: HTMLElement,
    props: SummaryViewProps,
): void {
    root.innerHTML = "";
    if (props.phase !== "ready") {
        renderPhaseBlock(root, props.phase, props.phaseMessage);
        return;
    }
    if (!props.summary) {
        if (props.task.status === "loading") {
            renderLoading(root, "AI 正在生成视频总结...");
        } else if (props.task.status === "error") {
            renderTaskError(root, props.task.error ?? "AI 总结生成失败");
        } else if (props.task.status === "disabled") {
            renderTaskDisabled(root, "已在「设置」中关闭「生成视频总结」");
        } else {
            renderTaskIdle(root, props.aiConfigured, "生成 AI 总结");
        }
        return;
    }

    const { summary } = props;
    if (props.doc && (summary.overview || summary.sections.length > 0)) {
        const exportRow = el("div", "bia-export-row");
        const exportButton = el(
            "button",
            "bia-export-btn",
            "⤓ 导出 Markdown",
        ) as HTMLButtonElement;
        exportButton.type = "button";
        exportButton.addEventListener("click", () => {
            if (props.doc) exportSummaryFile(props.doc, summary);
        });
        exportRow.appendChild(exportButton);
        root.appendChild(exportRow);
    }
    if (summary.overview) {
        root.appendChild(el("div", "bia-overview", summary.overview));
    }
    for (const section of summary.sections) {
        const card = el("div", "bia-section");
        const head = el("div", "bia-section-head");
        head.appendChild(el("span", "bia-time-badge", formatTime(section.start)));
        head.appendChild(el("span", "bia-section-title", section.title));
        card.appendChild(head);
        if (section.content) {
            card.appendChild(el("div", "bia-section-content", section.content));
        }
        card.addEventListener("click", () => props.onSeek(section.start));
        root.appendChild(card);
    }
    if (props.task.status === "loading") {
        root.appendChild(
            el("div", "bia-generating", "▍ AI 正在生成, 内容将逐步显示..."),
        );
    } else if (summary.sections.length === 0 && !summary.overview) {
        root.appendChild(el("div", "bia-placeholder", "AI 未返回有效内容, 请重试"));
    }
}
