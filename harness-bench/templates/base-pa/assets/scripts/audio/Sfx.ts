/**
 * Sfx — 全局音效服务（key 制）。
 *
 * 业务代码只发字符串 key，不直接引用 AudioClip：
 *   Sfx.play('click');          // 短音效（懒加载 + 按 key 节流）
 *   Sfx.playBgm('bgm');         // 背景音乐（循环，同 key 重复调用不重启）
 *   Sfx.stopBgm();
 *
 * key → 资源约定：resources/audio/<key>（AudioClip，mp3/ogg 均可）。
 * 资源缺失只警告一次并静默，不影响流程 —— 音频素材可以后补。
 *
 * 浏览器 autoplay 政策：首个用户手势前播放会被引擎静默丢弃，
 * Cocos web 端会在首次触摸后自动解锁 AudioContext，无需手动处理。
 *
 * 符号专属音效（SymbolDefs 的 enterSound/winSound/vanishSound）走
 * editor-app/sfx.ts 的 clip 直播通道，与本服务互不干扰。
 */

import { AudioClip, AudioSource, Node, director, resources } from "cc";

/** 音效资源目录（resources 下） */
const AUDIO_DIR = "audio";

/** 同一 key 的最小重播间隔（毫秒）：同帧多格消除只响一声 */
const DEFAULT_THROTTLE_MS = 90;

class SfxService {
    private clips = new Map<string, AudioClip>();
    /** 加载中 key → 完成后待播的音量（null 表示只预载不播） */
    private loading = new Map<string, number | null>();
    private missingWarned = new Set<string>();
    private lastPlayAt = new Map<string, number>();

    private oneShotSource: AudioSource | null = null;
    private bgmSource: AudioSource | null = null;
    private bgmKey = "";

    private _muted = false;

    // ---------------- 短音效 ----------------

    /** 播放短音效；未加载时先加载、加载完立即补播（超过节流窗则丢弃） */
    play(key: string, volume = 1): void {
        if (!key || this._muted) return;
        const clip = this.clips.get(key);
        if (clip) {
            this.playClip(key, clip, volume);
            return;
        }
        this.load(key, volume);
    }

    /** 预载一批 key（不播放），建议在入口处调用避免首次触发延迟 */
    preload(keys: string[]): void {
        for (const key of keys) {
            if (!this.clips.has(key) && !this.loading.has(key)) this.load(key, null);
        }
    }

    // ---------------- BGM ----------------

    /** 循环播放背景音乐；同 key 重复调用不重启 */
    playBgm(key: string, volume = 0.6): void {
        if (!key || (this.bgmKey === key && this.bgmSource?.playing)) return;
        this.bgmKey = key;
        const start = (clip: AudioClip) => {
            if (this.bgmKey !== key) return; // 已被切走
            const src = this.ensureBgmSource();
            if (!src) return;
            src.stop();
            src.clip = clip;
            src.loop = true;
            src.volume = this._muted ? 0 : volume;
            src.play();
        };
        const cached = this.clips.get(key);
        if (cached) {
            start(cached);
        } else {
            resources.load(`${AUDIO_DIR}/${key}`, AudioClip, (err, clip) => {
                if (err || !clip) {
                    this.warnMissing(key);
                    return;
                }
                this.clips.set(key, clip);
                start(clip);
            });
        }
    }

    stopBgm(): void {
        this.bgmKey = "";
        this.bgmSource?.stop();
    }

    // ---------------- 全局开关 ----------------

    get muted(): boolean {
        return this._muted;
    }

    setMuted(muted: boolean): void {
        this._muted = muted;
        if (this.bgmSource) this.bgmSource.volume = muted ? 0 : 0.6;
    }

    // ---------------- 内部 ----------------

    private load(key: string, volumeToPlay: number | null): void {
        const pending = this.loading.get(key);
        if (pending !== undefined) {
            // 已在加载：如果这次要播，记下音量等加载完成
            if (volumeToPlay !== null) this.loading.set(key, volumeToPlay);
            return;
        }
        this.loading.set(key, volumeToPlay);
        resources.load(`${AUDIO_DIR}/${key}`, AudioClip, (err, clip) => {
            const wanted = this.loading.get(key);
            this.loading.delete(key);
            if (err || !clip) {
                this.warnMissing(key);
                return;
            }
            this.clips.set(key, clip);
            if (wanted !== null && wanted !== undefined) this.playClip(key, clip, wanted);
        });
    }

    private playClip(key: string, clip: AudioClip, volume: number): void {
        const now = performance.now();
        const last = this.lastPlayAt.get(key) ?? -Infinity;
        if (now - last < DEFAULT_THROTTLE_MS) return;
        this.lastPlayAt.set(key, now);
        try {
            this.ensureOneShotSource()?.playOneShot(clip, volume);
        } catch (e) {
            console.warn(`[Sfx] playOneShot '${key}' failed`, e);
        }
    }

    private ensureOneShotSource(): AudioSource | null {
        if (this.oneShotSource?.isValid) return this.oneShotSource;
        this.oneShotSource = this.createSource("__sfx_oneshot__");
        return this.oneShotSource;
    }

    private ensureBgmSource(): AudioSource | null {
        if (this.bgmSource?.isValid) return this.bgmSource;
        this.bgmSource = this.createSource("__sfx_bgm__");
        return this.bgmSource;
    }

    private createSource(name: string): AudioSource | null {
        const scene = director.getScene();
        if (!scene) return null;
        const n = new Node(name);
        scene.addChild(n);
        director.addPersistRootNode(n);
        return n.addComponent(AudioSource);
    }

    private warnMissing(key: string): void {
        if (this.missingWarned.has(key)) return;
        this.missingWarned.add(key);
        console.warn(`[Sfx] 音效资源缺失: resources/${AUDIO_DIR}/${key}（静默跳过，补素材后自动生效）`);
    }
}

/** 全局单例 */
export const Sfx = new SfxService();
