# 公网反代（本地 Docker + SSH 反向隧道）

架构：

```
浏览器 → https://your.domain/psd/
      → VPS nginx
      → VPS 127.0.0.1:8810
      → SSH 反向隧道
      → 本机 Docker portal 127.0.0.1:8810
```

## 1. 本机 Docker

```powershell
cd docker/artist-preview
# .env 中设置 PUBLIC_BASE=https://your.domain/psd
docker compose up -d --build
```

## 2. 配置 VPS nginx（一次性）

```powershell
$env:ONLYCLAWS_HOST = "<VPS_IP_OR_HOST>"
$env:ONLYCLAWS_USER = "root"
$env:ONLYCLAWS_PASS = "<password>"   # 勿写入仓库
$env:ONLYCLAWS_PUBLIC_BASE = "https://your.domain/psd"
# 若站点文件名不是 Host 本身：
# $env:ONLYCLAWS_NGINX_SITE = "/etc/nginx/sites-available/your.domain"
python -u deploy/onlyclaws/configure_nginx_psd.py
```

## 3. 开反向隧道（需常驻）

```powershell
python -u deploy/onlyclaws/ssh_reverse_tunnel.py
```

笔记本休眠或隧道退出后公网会 502；重新跑第 3 步即可。
