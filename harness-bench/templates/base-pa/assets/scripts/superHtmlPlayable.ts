// =====================================================================
//  super-html playable 渠道桥（Cocos 商店 super-html 扩展，v5.x）
//
//  构建后由 super-html 打出的 HTML 按渠道注入 window.super_html（渠道
//  适配层）；游戏代码只跟本模块打交道。编辑器预览 / 未注入环境下所有
//  调用安全降级为 no-op（打日志），不影响开发调试。
// =====================================================================

/** 渠道注入的全局对象（构建产物里才存在） */
interface SuperHtmlBridge {
    google_play_url?: string;
    appstore_url?: string;
    /** 跳转商店（渠道内部根据平台选 google_play_url / appstore_url） */
    download?: () => void;
    /** 上报"试玩结束"（部分渠道用于计费/展示自家结算卡） */
    game_end?: () => void;
    /** 渠道自带下载按钮时为 true（如 ironSource），此时可隐藏自绘 CTA 按钮 */
    is_hide_download?: boolean;
}

class SuperHtmlPlayable {
    private get bridge(): SuperHtmlBridge | null {
        const w = globalThis as { super_html?: SuperHtmlBridge };
        return w.super_html ?? null;
    }

    /** 配置双端商店链接（应在游戏启动时调用一次） */
    public setStoreUrls(googlePlayUrl: string, appStoreUrl: string): void {
        const b = this.bridge;
        if (!b) {
            console.log("[superHtml] no bridge (preview?), store urls skipped");
            return;
        }
        b.google_play_url = googlePlayUrl;
        b.appstore_url = appStoreUrl;
    }

    /** CTA 点击：跳转商店 */
    public download(): void {
        console.log("[superHtml] download");
        this.bridge?.download?.();
    }

    /** 试玩结束（进 CTA 时上报一次） */
    public gameEnd(): void {
        console.log("[superHtml] game_end");
        this.bridge?.game_end?.();
    }

    /** 渠道是否要求隐藏自绘下载按钮 */
    public isHideDownload(): boolean {
        return !!this.bridge?.is_hide_download;
    }
}

export const superHtml = new SuperHtmlPlayable();
