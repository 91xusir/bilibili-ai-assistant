/** 本项目用到的 Chrome 扩展 API 最小类型声明 (MV3). */
declare namespace chrome {
    namespace runtime {
        /** 扩展环境中存在, 网页环境中为 undefined */
        const id: string | undefined;

        interface Port {
            name: string;
            postMessage(message: unknown): void;
            disconnect(): void;
            onMessage: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                addListener(callback: (message: any) => void): void;
            };
            onDisconnect: { addListener(callback: () => void): void };
        }

        function connect(connectInfo?: { name?: string }): Port;

        function sendMessage(message: unknown): Promise<unknown>;

        const onConnect: {
            addListener(callback: (port: Port) => void): void;
        };

        const onMessage: {
            addListener(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                callback: (
                    message: any,
                    sender: unknown,
                    sendResponse?: (response?: unknown) => void,
                ) => void,
            ): void;
            removeListener(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                callback: (message: any) => void,
            ): void;
        };
    }

    namespace storage {
        namespace local {
            function get(
                keys: string | string[] | null,
            ): Promise<Record<string, unknown>>;
            function set(items: Record<string, unknown>): Promise<void>;
            function remove(key: string | string[]): Promise<void>;
        }
    }

    namespace action {
        const onClicked: {
            addListener(
                callback: (tab: { id?: number | undefined }) => void,
            ): void;
        };
    }

    namespace tabs {
        interface Tab {
            id?: number | undefined;
            status?: string | undefined;
        }
        function create(info: {
            url: string;
            active?: boolean;
        }): Promise<Tab>;
        function get(tabId: number): Promise<Tab>;
        function remove(tabId: number): Promise<void>;
        function sendMessage(
            tabId: number,
            message: unknown,
        ): Promise<unknown>;
        const onUpdated: {
            addListener(
                callback: (
                    tabId: number,
                    changeInfo: { status?: string },
                    tab: Tab,
                ) => void,
            ): void;
            removeListener(
                callback: (
                    tabId: number,
                    changeInfo: { status?: string },
                    tab: Tab,
                ) => void,
            ): void;
        };
    }

    namespace scripting {
        function executeScript(injection: {
            target: { tabId: number };
            world?: "MAIN" | "ISOLATED";
            func: (...args: never[]) => unknown;
            args?: unknown[];
        }): Promise<{ result?: unknown }[]>;
    }
}
