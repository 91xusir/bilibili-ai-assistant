let container: HTMLElement | null = null;

export function showToast(
    message: string,
    type: "info" | "warn" | "error" = "info",
    duration = 2600,
): void {
    if (!container || !container.isConnected) {
        container = document.createElement("div");
        container.className = "bia-toast-wrap";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `bia-toast bia-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("bia-toast-show"));
    setTimeout(() => {
        toast.classList.remove("bia-toast-show");
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
