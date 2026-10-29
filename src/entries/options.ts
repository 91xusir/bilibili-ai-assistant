import { fetchModelList, testAiConnection } from "../api/ai";
import {
    getAiSettings,
    getFeatureSettings,
    saveAiSettings,
    saveFeatureSettings,
} from "../config/settings";
import { kimiAuthBootstrap } from "../core/kimi-port";
import { storageHydrate } from "../core/storage";
import { subtitleDeleteAll, subtitleList } from "../background/subtitle-db";
import type { AiProvider, ClickAction } from "../types";
import { el } from "../ui/common";
import { buildSegmentRow, buildSwitchRow } from "../ui/widgets";

/**
 * Options 选项页: 完整设置 (AI 任务 / 服务商 / 缓存 / 缓存管理).
 * Popup 只承载功能开关; 本页承载全部配置.
 */

// ---------------- AI 任务开关 ----------------

function buildTaskToggles(): void {
    const container = document.getElementById("task-toggles");
    if (!container) return;
    const features = getFeatureSettings();
    container.appendChild(
        buildSwitchRow(
            "自动总结",
            "进入视频后自动生成 AI 总结",
            features.autoSummary,
            (value) => saveFeatureSettings({ autoSummary: value }),
        ),
    );
    container.appendChild(
        buildSwitchRow(
            "识别广告",
            "识别视频中的广告片段",
            features.detectAds,
            (value) => saveFeatureSettings({ detectAds: value }),
        ),
    );
    container.appendChild(
        buildSwitchRow(
            "自动跳过广告",
            "自动跳过广告片段",
            features.autoSkipAds,
            (value) => saveFeatureSettings({ autoSkipAds: value }),
        ),
    );
    container.appendChild(
        buildSegmentRow<ClickAction>(
            "点击文本",
            "总结/时间轴点击文本行为; 点击时间徽章始终跳转",
            [
                { value: "jump", text: "跳转" },
                { value: "copy", text: "复制" },
            ],
            features.clickAction,
            (value) => saveFeatureSettings({ clickAction: value }),
        ),
    );
}

// ---------------- AI 服务商 ----------------

function buildProviderSection(): void {
    const providerRow = document.getElementById("provider-row");
    const kimiBox = document.getElementById("kimi-box");
    const openaiBox = document.getElementById("openai-box");
    const testRow = document.getElementById("test-row");
    if (!providerRow || !kimiBox || !openaiBox || !testRow) return;

    const kimiProviderButton = el(
        "button",
        "bia-provider-btn",
        "Kimi 网页版 (默认)",
    ) as HTMLButtonElement;
    const openaiProviderButton = el(
        "button",
        "bia-provider-btn",
        "OpenAI 兼容接口",
    ) as HTMLButtonElement;
    kimiProviderButton.type = "button";
    openaiProviderButton.type = "button";
    providerRow.append(kimiProviderButton, openaiProviderButton);
    let provider: AiProvider = getAiSettings().provider === "openai" ? "openai" : "kimi";

    // Kimi 授权块
    const kimiStatus = el(
        "div",
        "bia-kimi-status",
        "Kimi 授权状态: 未知 (点击下方按钮获取)",
    );
    const authButton = el(
        "button",
        "bia-btn",
        "重新获取授权",
    ) as HTMLButtonElement;
    authButton.type = "button";
    authButton.addEventListener("click", () => {
        kimiStatus.textContent = "正在获取授权 (可能打开 kimi.com 页面)...";
        void kimiAuthBootstrap().then((result) => {
            kimiStatus.textContent = result.ok
                ? `Kimi 授权已就绪 (refresh_token ${result.hasRefreshToken ? "✓" : "✗"})`
                : `授权失败: ${result.error ?? "未知"}`;
        });
    });
    const openKimiButton = el(
        "button",
        "bia-btn",
        "打开 kimi.com 登录",
    ) as HTMLButtonElement;
    openKimiButton.type = "button";
    openKimiButton.addEventListener("click", () => {
        void chrome.tabs.create({ url: "https://www.kimi.com/" });
    });
    const kimiButtonRow = el("div", "bia-kimi-button-row");
    kimiButtonRow.append(authButton, openKimiButton);
    kimiBox.append(
        kimiStatus,
        kimiButtonRow,
        el(
            "div",
            "hint",
            "无需 API Key, 直接使用 kimi.com 网页登录态 (每次任务创建独立会话, 完成后自动删除)。首次使用请先登录 kimi.com。",
        ),
    );

    // OpenAI 兼容配置块
    const makeField = (
        label: string,
        placeholder: string,
        type: string,
        secret = false,
    ): HTMLInputElement => {
        const field = el("label", "bia-field", label);
        const input = el("input", "bia-input") as HTMLInputElement;
        input.type = type;
        input.placeholder = placeholder;
        input.autocomplete = "off";
        input.spellcheck = false;
        // 不用 type=password: 避免浏览器密码管理器弹出"保存密码"
        if (secret) input.classList.add("bia-secret");
        field.appendChild(input);
        openaiBox.appendChild(field);
        return input;
    };
    const baseUrl = makeField("接口地址 Base URL", "https://api.openai.com/v1", "text");
    const apiKey = makeField("API Key (本地服务可留空)", "sk-...", "text", true);

    // 模型行: 输入框 + 自定义下拉 (datalist 会按当前值过滤)
    const modelField = el("div", "bia-field");
    modelField.appendChild(el("span", undefined, "模型名称"));
    const modelRow = el("div", "bia-model-row");
    const modelWrap = el("div", "bia-model-wrap");
    const model = el("input", "bia-input") as HTMLInputElement;
    model.type = "text";
    model.placeholder = "glm-4.6 / deepseek-chat / gpt-4o-mini";
    model.autocomplete = "off";
    model.spellcheck = false;
    const modelDropdown = el("div", "bia-model-dropdown");
    const modelClear = el("button", "bia-model-clear", "×") as HTMLButtonElement;
    modelClear.type = "button";
    modelClear.title = "清空模型名称";
    modelWrap.append(model, modelClear, modelDropdown);
    const fetchModelsButton = el(
        "button",
        "bia-btn bia-model-btn",
        "获取列表",
    ) as HTMLButtonElement;
    fetchModelsButton.type = "button";
    fetchModelsButton.title = "从上游接口拉取模型列表 (GET /models)";

    const modelOptions: string[] = [];
    const renderModelDropdown = (filter: string) => {
        modelDropdown.innerHTML = "";
        const value = filter.trim().toLowerCase();
        let list = modelOptions;
        if (value) {
            const filtered = list.filter((id) => id.toLowerCase().includes(value));
            if (filtered.length > 0) list = filtered; // 无匹配则显示全部
        }
        for (const id of list) {
            const item = el("div", "bia-model-item", id);
            if (id === model.value) item.classList.add("bia-current");
            item.addEventListener("click", () => {
                model.value = id;
                updateClearButton();
                closeModelDropdown();
            });
            modelDropdown.appendChild(item);
        }
        modelDropdown.classList.toggle("bia-open", list.length > 0);
    };
    const closeModelDropdown = () => modelDropdown.classList.remove("bia-open");
    const openModelDropdown = () => renderModelDropdown(model.value);
    const updateClearButton = () =>
        modelWrap.classList.toggle("has-value", model.value.length > 0);
    modelClear.addEventListener("click", () => {
        model.value = "";
        updateClearButton();
        renderModelDropdown("");
        model.focus();
    });
    model.addEventListener("focus", openModelDropdown);
    model.addEventListener("click", openModelDropdown);
    model.addEventListener("input", () => {
        updateClearButton();
        renderModelDropdown(model.value);
    });
    model.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeModelDropdown();
    });
    document.addEventListener("click", (event) => {
        if (!modelWrap.contains(event.target as Node)) closeModelDropdown();
    });

    const effortField = el("label", "bia-field", "思考等级 (reasoning effort)");
    const effortSelect = el("select", "bia-input") as HTMLSelectElement;
    for (const item of [
        { value: "", label: "关闭思考模式 (默认)" },
        { value: "low", label: "低 (low)" },
        { value: "medium", label: "中 (medium)" },
        { value: "high", label: "高 (high)" },
    ]) {
        const option = el("option");
        option.value = item.value;
        option.textContent = item.label;
        effortSelect.appendChild(option);
    }
    effortField.appendChild(effortSelect);

    const testResult = el("span", "bia-test-result");
    const testButton = el("button", "bia-btn", "测试连接") as HTMLButtonElement;
    testButton.type = "button";
    testButton.addEventListener("click", () => {
        saveOpenAiFields();
        testResult.className = "bia-test-result";
        testResult.textContent = "测试中...";
        testAiConnection()
            .then((reply) => {
                testResult.textContent = `连接成功: ${reply || "OK"}`;
                testResult.classList.add("bia-test-ok");
            })
            .catch((error) => {
                testResult.textContent =
                    error instanceof Error ? error.message : String(error);
                testResult.classList.add("bia-test-fail");
            });
    });
    testRow.append(testButton, testResult);

    fetchModelsButton.addEventListener("click", () => {
        saveOpenAiFields();
        fetchModelsButton.textContent = "获取中...";
        testResult.className = "bia-test-result";
        fetchModelList()
            .then((ids) => {
                modelOptions.splice(0, modelOptions.length, ...ids);
                testResult.textContent = `已加载 ${ids.length} 个模型, 点击输入框可选`;
                testResult.classList.add("bia-test-ok");
                openModelDropdown();
            })
            .catch((error) => {
                testResult.textContent =
                    error instanceof Error ? error.message : String(error);
                testResult.classList.add("bia-test-fail");
            })
            .finally(() => {
                setTimeout(() => {
                    fetchModelsButton.textContent = "获取列表";
                }, 2500);
            });
    });

    modelRow.append(modelWrap, fetchModelsButton);
    modelField.appendChild(modelRow);
    openaiBox.appendChild(modelField);
    openaiBox.appendChild(effortField);

    const renderProvider = () => {
        kimiProviderButton.classList.toggle("bia-active", provider === "kimi");
        openaiProviderButton.classList.toggle(
            "bia-active",
            provider === "openai",
        );
        kimiBox.style.display = provider === "kimi" ? "block" : "none";
        openaiBox.style.display = provider === "openai" ? "block" : "none";
    };
    kimiProviderButton.addEventListener("click", () => {
        provider = "kimi";
        saveAiSettings({ provider });
        renderProvider();
    });
    openaiProviderButton.addEventListener("click", () => {
        provider = "openai";
        saveAiSettings({ provider });
        renderProvider();
    });

    // 回填当前配置
    const saved = getAiSettings();
    baseUrl.value = saved.baseUrl;
    apiKey.value = saved.apiKey;
    model.value = saved.model;
    effortSelect.value = saved.reasoningEffort ?? "";
    updateClearButton();
    renderProvider();

    function saveOpenAiFields(): void {
        saveAiSettings({
            provider,
            baseUrl: baseUrl.value.trim(),
            apiKey: apiKey.value.trim(),
            model: model.value.trim(),
            reasoningEffort: effortSelect.value,
        });
    }
    // 供保存按钮复用
    (window as unknown as { __biaSaveOpenAiFields?: () => void }).__biaSaveOpenAiFields =
        saveOpenAiFields;
}

// ---------------- 缓存设置 ----------------

function buildCacheBox(): void {
    const container = document.getElementById("cache-box");
    if (!container) return;
    const settings = getAiSettings();
    container.appendChild(
        buildSwitchRow(
            "启用缓存",
            "同时作用于字幕缓存与总结/广告缓存",
            settings.cacheEnabled !== false,
            (value) => saveAiSettings({ cacheEnabled: value }),
        ),
    );
    const ttlField = el("label", "bia-field", "缓存保留时长 (小时)");
    const ttlInput = el("input", "bia-input") as HTMLInputElement;
    ttlInput.type = "number";
    ttlInput.min = "0";
    ttlInput.step = "1";
    ttlInput.placeholder = "0 = 永久保留, 到期自动删除";
    ttlInput.dataset.role = "cache-ttl";
    const savedTtl = settings.cacheTtlHours;
    ttlInput.value = String(
        Number.isFinite(savedTtl) && savedTtl > 0 ? Math.round(savedTtl) : 0,
    );
    ttlField.appendChild(ttlInput);
    container.appendChild(ttlField);
}

// ---------------- 缓存管理 ----------------

interface CacheEntryInfo {
    key: string;
    title: string;
    savedAt: number;
    bytes: number;
    hasSubtitle: boolean;
    hasSummary: boolean;
}

async function listCacheEntries(): Promise<CacheEntryInfo[]> {
    const map = new Map<string, CacheEntryInfo>();
    try {
        // 字幕缓存: SW 侧扩展源 IndexedDB, 选项页同源可直接读
        for (const item of await subtitleList()) {
            map.set(item.key, {
                key: item.key,
                title: item.title || item.key,
                savedAt: item.savedAt,
                bytes: item.bytes,
                hasSubtitle: true,
                hasSummary: false,
            });
        }
    } catch {
        /* IDB 不可用时仅显示总结缓存 */
    }
    const all = (await chrome.storage.local.get(null)) as Record<
        string,
        unknown
    >;
    for (const [storageKey, value] of Object.entries(all)) {
        if (!storageKey.startsWith("bia:ai-cache:")) continue;
        const key = storageKey.slice("bia:ai-cache:".length);
        const entry = value as { savedAt?: number };
        const prev = map.get(key);
        map.set(key, {
            key,
            title: prev?.title ?? key,
            savedAt: Math.max(prev?.savedAt ?? 0, Number(entry?.savedAt ?? 0)),
            bytes: (prev?.bytes ?? 0) + JSON.stringify(value ?? {}).length,
            hasSubtitle: prev?.hasSubtitle ?? false,
            hasSummary: true,
        });
    }
    return [...map.values()].sort((a, b) => b.savedAt - a.savedAt);
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
}

async function renderCacheManage(): Promise<void> {
    const container = document.getElementById("cache-manage");
    if (!container) return;
    container.innerHTML = "";
    const entries = await listCacheEntries();
    if (entries.length === 0) {
        container.appendChild(el("div", "bia-cache-empty", "暂无缓存"));
        return;
    }

    const toolbar = el("div", "bia-cache-toolbar");
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    const selectAllLabel = el("label", undefined, "全选");
    selectAllLabel.prepend(selectAll);
    const countText = el("span", undefined, `共 ${entries.length} 个视频`);
    const clearButton = el("button", "bia-btn", "清理选中") as HTMLButtonElement;
    clearButton.type = "button";
    clearButton.disabled = true;
    toolbar.append(selectAllLabel, countText, clearButton);
    container.appendChild(toolbar);

    const list = el("div", "bia-cache-list");
    const checkboxes: HTMLInputElement[] = [];
    const updateState = () => {
        const checked = checkboxes.filter((box) => box.checked);
        clearButton.disabled = checked.length === 0;
        selectAll.checked =
            checked.length === checkboxes.length && checkboxes.length > 0;
        selectAll.indeterminate =
            !selectAll.checked && checked.length > 0;
    };
    for (const entry of entries) {
        const item = el("div", "bia-cache-item");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.key = entry.key;
        checkbox.addEventListener("change", updateState);
        const main = el("div", "bia-cache-main");
        main.appendChild(el("div", "bia-cache-title", entry.title));
        const when = entry.savedAt
            ? new Date(entry.savedAt).toLocaleString()
            : "";
        main.appendChild(
            el(
                "div",
                "bia-cache-meta",
                `${entry.key} · ${formatBytes(entry.bytes)} · ${when}`,
            ),
        );
        const kinds = [
            entry.hasSubtitle ? "字幕" : "",
            entry.hasSummary ? "总结/广告" : "",
        ]
            .filter(Boolean)
            .join(" + ");
        item.append(checkbox, main, el("span", "bia-cache-badge", kinds));
        list.appendChild(item);
        checkboxes.push(checkbox);
    }
    container.appendChild(list);

    selectAll.addEventListener("change", () => {
        for (const checkbox of checkboxes) checkbox.checked = selectAll.checked;
        updateState();
    });
    clearButton.addEventListener("click", () => {
        const selected = checkboxes
            .filter((box) => box.checked)
            .map((box) => box.dataset.key ?? "")
            .filter(Boolean);
        void (async () => {
            clearButton.disabled = true;
            clearButton.textContent = "清理中...";
            try {
                // 不区分类型: 该视频的字幕 (IDB) 与总结/广告 (storage) 一起删除
                await subtitleDeleteAll(selected);
                await Promise.all(
                    selected.map((key) =>
                        chrome.storage.local.remove(`bia:ai-cache:${key}`),
                    ),
                );
            } finally {
                clearButton.textContent = "清理选中";
                await renderCacheManage();
            }
        })();
    });
    updateState();
}

// ---------------- 保存按钮 ----------------

function buildSaveButton(): void {
    const row = document.getElementById("save-row");
    if (!row) return;
    const saveButton = el(
        "button",
        "bia-btn bia-btn-primary",
        "保存设置",
    ) as HTMLButtonElement;
    saveButton.type = "button";
    saveButton.addEventListener("click", () => {
        const ttlInput = document.querySelector<HTMLInputElement>(
            'input[data-role="cache-ttl"]',
        );
        const ttl = Number(ttlInput?.value ?? "0");
        saveAiSettings({
            cacheTtlHours:
                Number.isFinite(ttl) && ttl > 0 ? Math.round(ttl) : 0,
        });
        (window as unknown as { __biaSaveOpenAiFields?: () => void })
            .__biaSaveOpenAiFields?.();
        saveButton.textContent = "已保存 ✓";
        setTimeout(() => {
            saveButton.textContent = "保存设置";
        }, 1800);
    });
    row.appendChild(saveButton);
}

async function init(): Promise<void> {
    await storageHydrate();
    buildTaskToggles();
    buildProviderSection();
    buildCacheBox();
    buildSaveButton();
    await renderCacheManage();
}

void init();
