# Pre-baked engine snapshot

Put a Creator 3.8.8 preview snapshot here as `engine-snapshot/`:

```
engine-snapshot/
  preview/
  native-external/
  internal-library/
```

`preview-mirror` picks this directory first, then `spike/engine-snapshot/`.

Do not commit the binaries (Cocos license). Copy from an existing bake:

```powershell
robocopy ..\..\spike\engine-snapshot .\engine-snapshot /E
```
