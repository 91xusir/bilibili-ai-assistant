const VIDEO_SELECTORS = [
    ".bpx-player-video-wrap video",
    "#bilibili-player video",
    ".bpx-player-container video",
    "video",
];

/**
 * 绑定播放器 <video> 元素: timeupdate 回调 + 点击跳转.
 * 播放器可能被 B 站重建, 每 3 秒轮询一次重新绑定.
 */
export class VideoBinder {
    private video: HTMLVideoElement | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private removeTimeUpdate: (() => void) | null = null;

    constructor(private onTimeUpdate: (time: number) => void) {}

    start(): void {
        this.stop();
        this.bind();
        this.timer = setInterval(() => this.bind(), 3000);
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.unbind();
    }

    seek(time: number): void {
        const video = this.video && document.contains(this.video)
            ? this.video
            : this.findVideo();
        if (!video) return;
        try {
            video.currentTime = time;
        } catch {
            /* 视频未就绪时忽略 */
        }
    }

    getCurrentTime(): number | null {
        return this.video && document.contains(this.video)
            ? this.video.currentTime
            : null;
    }

    private findVideo(): HTMLVideoElement | null {
        for (const selector of VIDEO_SELECTORS) {
            const video = document.querySelector<HTMLVideoElement>(selector);
            if (video) return video;
        }
        return null;
    }

    private bind(): void {
        if (this.video && document.contains(this.video)) return;
        const video = this.findVideo();
        if (!video) return;
        this.unbind();
        this.video = video;
        const handler = () => this.onTimeUpdate(video.currentTime);
        video.addEventListener("timeupdate", handler);
        this.removeTimeUpdate = () =>
            video.removeEventListener("timeupdate", handler);
    }

    private unbind(): void {
        this.removeTimeUpdate?.();
        this.removeTimeUpdate = null;
        this.video = null;
    }
}
