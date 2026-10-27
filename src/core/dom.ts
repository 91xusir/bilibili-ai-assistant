export interface WaitForElementOptions {
    parent?: Element | Document;
    timeout?: number;
}

/**
 * 等待匹配选择器的元素出现 (MutationObserver + 轮询兜底).
 */
export function waitForElement(
    selector: string,
    options: WaitForElementOptions = {},
): Promise<Element> {
    const parent = options.parent ?? document;
    const existing = parent.querySelector(selector);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
        const observeTarget =
            parent instanceof Document ? document.documentElement : parent;
        let finished = false;

        const cleanup = () => {
            finished = true;
            observer.disconnect();
            clearInterval(pollTimer);
            clearTimeout(timeoutTimer);
        };

        const check = () => {
            if (finished) return;
            const found = parent.querySelector(selector);
            if (found) {
                cleanup();
                resolve(found);
            }
        };

        const observer = new MutationObserver(check);
        observer.observe(observeTarget, { childList: true, subtree: true });
        const pollTimer = setInterval(check, 500);
        const timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error(`等待元素超时: ${selector}`));
        }, options.timeout ?? 60_000);
    });
}
