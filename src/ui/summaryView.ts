import { formatTime } from "../subtitle";
import type {
    ClickAction,
    SubtitleDoc,
    SummaryResult,
    TaskState,
} from "../types";
import {
    el,
    renderLoading,
    renderPhaseBlock,
    renderTaskError,
    type Phase,
} from "./common";

export interface SummaryViewProps {
    phase: Phase;
    phaseMessage: string;
    task: TaskState;
    aiConfigured: boolean;
    doc: SubtitleDoc | null;
    summary: SummaryResult | null;
    clickAction: ClickAction;
    onSeek: (time: number) => void;
    onCopy: (text: string) => void;
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
            root.appendChild(
                el(
                    "div",
                    "bia-placeholder",
                    "已关闭「自动总结」\n点击右下角 ⟳ 按钮手动生成",
                ),
            );
        } else if (props.aiConfigured) {
            root.appendChild(
                el(
                    "div",
                    "bia-placeholder",
                    "自动总结已关闭\n点击右下角 ⟳ 按钮生成 AI 总结",
                ),
            );
        } else {
            root.appendChild(
                el(
                    "div",
                    "bia-placeholder",
                    "未配置 AI 接口\n\n点击工具栏扩展图标 → 「完整设置」",
                ),
            );
        }
        return;
    }

    const { summary } = props;
    // 点击文本: 跳转 或 复制该章节内容 (时间徽章始终跳转)
    const sectionClick = (time: number, text: string) => {
        if (props.clickAction === "copy" && text) props.onCopy(text);
        else props.onSeek(time);
    };

    if (summary.overview) {
        root.appendChild(el("div", "bia-overview", summary.overview));
    }
    for (const section of summary.sections) {
        const card = el("div", "bia-section");
        const head = el("div", "bia-section-head");
        const badge = el("span", "bia-time-badge", formatTime(section.start));
        badge.title = "跳转到此时间";
        badge.addEventListener("click", (event) => {
            event.stopPropagation();
            props.onSeek(section.start);
        });
        head.appendChild(badge);
        head.appendChild(el("span", "bia-section-title", section.title));
        card.appendChild(head);
        if (section.content) {
            card.appendChild(el("div", "bia-section-content", section.content));
        }
        card.addEventListener("click", () =>
            sectionClick(section.start, section.content || section.title),
        );
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
