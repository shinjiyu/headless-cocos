# T01 — CTA Mask 宽度

工程：真实 PA（`templates/base-pa`，源自 AIWS smoke/demo/pa）。

CTA 的 Mask 过窄，内容被裁切。

改 `assets/resources/prefab/CTA.prefab`：
- 找到节点 `Mask` 上的 `cc.UITransform`，把 `_contentSize.width` 从 **220** 加宽到 **至少 700**（高度可保持 1280）。
- 不要改无关节点；不要动 .meta UUID。
