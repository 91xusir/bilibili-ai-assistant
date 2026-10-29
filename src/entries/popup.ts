import {
    getAiSettings,
    getFeatureSettings,
    saveAiSettings,
    saveFeatureSettings,
} from "../config/settings";
import { storageHydrate } from "../core/storage";
import type { ClickAction } from "../types";
import { buildSegmentRow, buildSwitchRow } from "../ui/widgets";

/**
 * 工具栏 Popup: 仅功能开关 (即时保存).
 * 完整配置 (AI 接口 / 缓存管理) 在 Options 选项页.
 */
async function init(): Promise<void> {
    await storageHydrate();
    const root = document.getElementById("toggles");
    if (!root) return;

    const render = (): void => {
        root.innerHTML = "";
        const f = getFeatureSettings();
        root.appendChild(
            buildSwitchRow(
                "自动总结",
                "进入视频后自动生成 AI 总结",
                f.autoSummary,
                (value) => saveFeatureSettings({ autoSummary: value }),
            ),
        );
        root.appendChild(
            buildSwitchRow(
                "识别广告",
                "识别视频中的广告片段",
                f.detectAds,
                (value) => saveFeatureSettings({ detectAds: value }),
            ),
        );
        root.appendChild(
            buildSwitchRow(
                "自动跳过广告",
                "关闭后播放到广告时弹提示确认",
                f.autoSkipAds,
                (value) => saveFeatureSettings({ autoSkipAds: value }),
            ),
        );
        root.appendChild(
            buildSegmentRow<ClickAction>(
                "点击文本",
                "点击时间徽章始终跳转播放位置",
                [
                    { value: "jump", text: "跳转" },
                    { value: "copy", text: "复制" },
                ],
                f.clickAction,
                (value) => saveFeatureSettings({ clickAction: value }),
            ),
        );
        root.appendChild(
            buildSwitchRow(
                "启用缓存",
                "缓存字幕与总结/广告结果 (TTL 在选项页设置)",
                getAiSettings().cacheEnabled !== false,
                (value) => saveAiSettings({ cacheEnabled: value }),
            ),
        );
    };
    render();

    // 选项页同时开着时保持同步
    chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === "local") render();
    });

    document
        .getElementById("open-options")
        ?.addEventListener("click", () => {
            void chrome.runtime.openOptionsPage();
        });
}

void init();
