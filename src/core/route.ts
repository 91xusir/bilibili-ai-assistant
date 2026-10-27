type RouteCallback = (to: string) => void;

/**
 * 监听 B 站 SPA 路由变化. 优先使用 Navigation API, 降级为劫持 history.
 */
export function onRouteChange(callback: RouteCallback): () => void {
    const navigation = window.navigation;
    if (navigation && typeof navigation.addEventListener === "function") {
        const handler = (event: Event) => {
            const destination = (
                event as Event & { destination?: { url?: string } }
            ).destination;
            try {
                callback(String(destination?.url ?? location.href));
            } catch {
                /* 回调异常不应中断路由监听 */
            }
        };
        navigation.addEventListener("navigate", handler);
        return () => navigation.removeEventListener("navigate", handler);
    }

    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    const fire = (url: string | null, from: string) => {
        const full = url ? new URL(String(url), from).href : location.href;
        try {
            callback(full);
        } catch {
            /* ignore */
        }
    };

    history.pushState = function (data, unused, url) {
        const from = location.href;
        originalPush(data, unused, url);
        fire(url as string | null, from);
    } as typeof history.pushState;

    history.replaceState = function (data, unused, url) {
        const from = location.href;
        originalReplace(data, unused, url);
        fire(url as string | null, from);
    } as typeof history.replaceState;

    const onPop = () => {
        try {
            callback(location.href);
        } catch {
            /* ignore */
        }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);

    return () => {
        history.pushState = originalPush;
        history.replaceState = originalReplace;
        window.removeEventListener("popstate", onPop);
        window.removeEventListener("hashchange", onPop);
    };
}
