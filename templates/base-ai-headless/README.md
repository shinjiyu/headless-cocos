# baseAIAutoCocos-headless

Cocos Creator **3.8.8** AI tooling base for **headless** preview.

同源 [baseAIAutoCocos](https://github.com/shinjiyu/baseAIAutoCocos)，只留无头预览需要的部分：

| 有 | 无 |
|----|----|
| ViewWeaver（`extensions/viewweaver` → `assets/scripts/views/`） | `cocos-meta-mcp` / 任何 MCP |
| 3.8.8 `settings/` | Board / MainUI / CTA / symbol-library |
| 可启动 `assets/scene/PreviewBoot.scene`（**2D** Canvas + 正交 Camera） | 官方 Empty 那种「要 IDE 第一次打开才长 assets」 |
| `assets/resources`（`isBundle`） | Creator preview-refresh skills |

这是 **2D** 默认壳。3D 用 `--template base-ai-3d`。

改 UI：直接改 `assets/**/*.prefab` / `.scene`。磁盘是唯一真相，无头栈 watch 后进 `library/` 并 HMR。

预览栈：[headless-cocos](https://github.com/shinjiyu/headless-cocos)。引擎快照预埋在那边的 `spike/engine-snapshot/`，不必开 Creator。

场景分支：[baseAIAutoCocos `headless`](https://github.com/shinjiyu/baseAIAutoCocos/tree/headless)（`master` 是 Creator + MCP）。

## 建工程

```powershell
cd D:\tempWorkspace\headless-cocos-research
node spike/create-project.mjs --template base-ai --out D:\tempWorkspace\my-game
$env:PROJECT="D:\tempWorkspace\my-game"
$env:PACKER="mini"
node spike/preview-mirror.mjs
```
