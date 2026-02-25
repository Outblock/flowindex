/// <reference types="vite/client" />

interface Window {
    __FLOWSCAN_ENV__?: {
        DOCS_URL?: string;
    };
}

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_WS_URL: string;
    readonly VITE_DOCS_URL: string;
    readonly VITE_AI_CHAT_URL: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
