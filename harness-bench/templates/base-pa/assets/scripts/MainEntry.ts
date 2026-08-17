import { Component, Input, Node, Prefab, _decorator, input, instantiate, resources } from "cc";
import { PREVIEW } from "cc/env";
import { Sfx } from "./audio/Sfx";
import { superHtml } from "./superHtmlPlayable";
import { CTAView } from "./_genbot/CTA/CTA.view";
import { MainUIView } from "./_genbot/MainUI/MainUI.view";

const { ccclass } = _decorator;

/** MainUI / CTA prefab 在 resources 里的路径（不含扩展名） */
const MAIN_UI_PREFAB = "prefab/MainUI";
const CTA_PREFAB = "prefab/CTA";

/** 用户无操作跳转 CTA 的时限（秒） */
const IDLE_TIMEOUT = 120;

/** 双端商店链接（super-html 渠道桥用） */
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.boge.lgmahjong&gl=US&pli=1";
const APP_STORE_URL = "https://apps.apple.com/tw/app/id6449517782";

/**
 * 场景入口：运行时动态加载 MainUI prefab，实例化后挂 genbot View 并完成绑定。
 * 场景与 prefab 均不含业务脚本（genbot 契约）。
 *
 * CTA 跳转时机：
 *   · 用户 2 分钟无任何触摸操作；
 *   · 或盘面全部动画播完。
 */
@ccclass("MainEntry")
export class MainEntry extends Component {
    private _view: MainUIView | null = null;
    private _mainRoot: Node | null = null;
    private _ctaView: CTAView | null = null;
    /** 已触发 CTA 跳转（加载中也算，防止重复触发） */
    private _ctaShown = false;

    /** 距上次用户操作的秒数 */
    private _idleElapsed = 0;

    onLoad(): void {
        superHtml.setStoreUrls(GOOGLE_PLAY_URL, APP_STORE_URL);

        // BGM：先直接尝试自动播（部分 webview/渠道允许）；
        // 被浏览器 autoplay 政策拦下时，由下面注册的任意首个手势补播（playBgm 幂等）
        Sfx.playBgm("bgm");

        resources.load(MAIN_UI_PREFAB, Prefab, (err, prefab) => {
            if (err || !prefab) {
                console.error(`[MainEntry] load ${MAIN_UI_PREFAB} failed:`, err);
                return;
            }
            const root = instantiate(prefab);
            this.node.addChild(root);
            this._mainRoot = root;
            this._view = root.addComponent(MainUIView);
            this._view.bind(root);
            this._view.onAllPlayed = () => this.showCTA();
            // 仅 Creator 预览：正式/渠道包不会走这里（PREVIEW=false）
            if (PREVIEW) this.installLayoutBootstrap();
        });

        // 触摸 + 鼠标都算用户操作（桌面预览点鼠标、移动端触摸都能解锁音频）
        input.on(Input.EventType.TOUCH_START, this.onUserInput, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onUserInput, this);
    }

    onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onUserInput, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onUserInput, this);
    }

    update(dt: number): void {
        if (this._ctaShown) return;
        this._idleElapsed += dt;
        if (this._idleElapsed >= IDLE_TIMEOUT) {
            this.showCTA();
        }
    }

    private onUserInput(): void {
        this._idleElapsed = 0;
        // 首个用户手势是 WebAudio 解锁点，从这里起 BGM（重复调用无副作用）
        Sfx.playBgm("bgm");
    }

    /** 跳转 CTA：MainUI 保留在底层（暂停交互），CTA 盖在上层，把当前总分带过去继续滚 */
    private showCTA(): void {
        if (this._ctaShown) return;
        this._ctaShown = true;

        const score = this._view?.score ?? 0;
        // 底层 MainUI 不再响应触摸（开始按钮/盘面点击都停掉），但继续渲染
        this._mainRoot?.pauseSystemEvents(true);
        // 渠道桥：上报试玩结束
        superHtml.gameEnd();

        resources.load(CTA_PREFAB, Prefab, (err, prefab) => {
            if (err || !prefab) {
                console.error(`[MainEntry] load ${CTA_PREFAB} failed:`, err);
                return;
            }
            const root = instantiate(prefab);
            this.node.addChild(root);
            this._ctaView = root.addComponent(CTAView);
            this._ctaView.bind(root);
            if (score > 0) this._ctaView.setScore(score);
        });
    }

    public get view(): MainUIView | null {
        return this._view;
    }

    public get ctaView(): CTAView | null {
        return this._ctaView;
    }

    /**
     * AI Game Workspace 布局编辑引导（仅 PREVIEW）。
     * - 正式/super-html 打包：PREVIEW=false，整段不执行。
     * - layout-inject.js 不进工程，只从本机 8780 动态加载。
     * - 触发：URL ?aiws_layout=1，或父页 postMessage load-inject（Workspace 布局 Tab）。
     */
    private installLayoutBootstrap(): void {
        if (!PREVIEW) return;
        try {
            const g = globalThis as any;
            if (g.__AIWS_LAYOUT_BOOT__) return;
            g.__AIWS_LAYOUT_BOOT__ = true;

            const host = String(g.location?.hostname || "");
            if (host !== "127.0.0.1" && host !== "localhost") return;

            const loadInject = () => {
                const doc = g.document;
                if (!doc?.head) return;
                // 允许热更：去掉旧脚本再挂新版（带 cache bust）
                doc.getElementById("aiws-layout-inject")?.remove();
                const s = doc.createElement("script");
                s.id = "aiws-layout-inject";
                s.src = `http://127.0.0.1:8780/layout-inject.js?v=${Date.now()}`;
                s.async = true;
                doc.head.appendChild(s);
                console.log("[MainEntry] AIWS layout editor loading");
            };

            g.addEventListener("message", (ev: MessageEvent) => {
                const d = ev?.data;
                if (!d || d.source !== "aiws-layout-host") return;
                if (d.type === "load-inject" || (d.type === "set-enabled" && d.enabled)) {
                    loadInject();
                }
            });

            try {
                g.parent?.postMessage({ source: "aiws-layout", type: "boot" }, "*");
            } catch {
                /* ignore */
            }

            const q = new URLSearchParams(String(g.location?.search || ""));
            if (q.has("aiws_layout")) loadInject();
        } catch (e) {
            console.warn("[MainEntry] layout bootstrap failed", e);
        }
    }
}
