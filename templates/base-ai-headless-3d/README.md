# baseAIAutoCocos-headless-3d

`base-ai` 的 **3D overlay**。`create-project --template base-ai-3d` 先拷 2D 壳，再用本目录覆盖启动场景和引擎模块。

| 有 | 无 |
|----|----|
| 透视 `Main Camera`、`Main Light`、非黑 ambient、示例 `Cube` | Canvas / 正交 UI 相机（要 UI 自己往场景加） |
| `engine.json` 打开 `3d` + `primitive` | 官方 Empty 那种「要 IDE 第一次打开才长 assets」 |
| 与 `base-ai` 同一套 ViewWeaver / settings | MCP |

内置 mesh / material UUID 写在工程根 `AGENT_AUTHORING.md` 的 3D 节，不要翻 `internal-library/`。

```powershell
node spike/bootstrap.mjs --template base-ai-3d --out <GAME>
```
