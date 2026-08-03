#!/usr/bin/env python3
"""Configure VPS nginx /psd/ → SSH tunnel (local artist-preview portal).

Required env:
  ONLYCLAWS_PASS
  ONLYCLAWS_HOST          # VPS IP or hostname
Optional:
  ONLYCLAWS_USER          # default root
  ONLYCLAWS_PSD_PORT      # default 8810
  ONLYCLAWS_PUBLIC_BASE   # e.g. https://your.domain/psd
  ONLYCLAWS_NGINX_SITE    # default /etc/nginx/sites-available/<host>
"""
import os
import re
import sys

import paramiko

HOST = os.environ.get('ONLYCLAWS_HOST', '').strip()
USER = os.environ.get('ONLYCLAWS_USER', 'root')
PASSWORD = os.environ['ONLYCLAWS_PASS']
REMOTE_PORT = int(os.environ.get('ONLYCLAWS_PSD_PORT', '8810'))
PUBLIC_BASE = os.environ.get('ONLYCLAWS_PUBLIC_BASE', '').rstrip('/')
NGINX_PATH = os.environ.get(
  'ONLYCLAWS_NGINX_SITE',
  f'/etc/nginx/sites-available/{HOST}' if HOST else '',
)

PSD_BLOCK = f'''
    # PSD Artist Preview (local Docker via SSH reverse tunnel to 127.0.0.1:{REMOTE_PORT})
    location = /psd {{ return 301 /psd/; }}
    location ^~ /psd/ {{
        proxy_pass         http://127.0.0.1:{REMOTE_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        client_max_body_size 2048m;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_request_buffering off;
    }}
'''


def run(client, cmd, timeout=60):
  stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
  out = stdout.read().decode('utf-8', 'replace')
  err = stderr.read().decode('utf-8', 'replace')
  code = stdout.channel.recv_exit_status()
  if code != 0:
    raise RuntimeError(f'cmd failed ({code}): {cmd}\n{out}\n{err}')
  return out


def insert_or_refresh(cfg):
  if 'location ^~ /psd/' in cfg:
    cfg2, n = re.subn(
      r'\n    # PSD Artist Preview.*?location \^~ /psd/ \{.*?\n    \}\n',
      '\n' + PSD_BLOCK,
      cfg,
      count=1,
      flags=re.S,
    )
    if n:
      return cfg2, 'refreshed'
    return cfg, 'unchanged'
  if 'location ^~ /umbra/' in cfg:
    return (
      cfg.replace(
        '    location ^~ /umbra/',
        PSD_BLOCK + '\n    location ^~ /umbra/',
        1,
      ),
      'inserted',
    )
  if 'listen 443 ssl; # managed by Certbot' in cfg:
    return (
      cfg.replace(
        '    listen 443 ssl; # managed by Certbot',
        PSD_BLOCK + '\n    listen 443 ssl; # managed by Certbot',
        1,
      ),
      'inserted',
    )
  return (
    cfg.replace('    location / {', PSD_BLOCK + '\n    location / {', 1),
    'inserted',
  )


def main():
  if not HOST:
    raise SystemExit('ONLYCLAWS_HOST is required')
  if not NGINX_PATH:
    raise SystemExit('ONLYCLAWS_NGINX_SITE is required')

  client = paramiko.SSHClient()
  client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
  client.connect(HOST, username=USER, password=PASSWORD, timeout=25)
  cfg = run(client, f'cat {NGINX_PATH}')
  cfg2, action = insert_or_refresh(cfg)
  print(f'nginx: /psd/ {action}')

  if cfg2 != cfg:
    run(client, f'cp {NGINX_PATH} {NGINX_PATH}.bak.psd')
    sftp = client.open_sftp()
    with sftp.file(NGINX_PATH, 'w') as f:
      f.write(cfg2)
    sftp.close()

  print(run(client, 'nginx -t'))
  run(client, 'systemctl reload nginx')
  print('nginx reloaded')
  pub = PUBLIC_BASE or f'https://{HOST}/psd'
  print(f'OK: {pub}/ → 127.0.0.1:{REMOTE_PORT}')
  print('Keep SSH reverse tunnel alive from your PC.')
  client.close()


if __name__ == '__main__':
  try:
    main()
  except Exception as e:
    print('ERROR:', e, file=sys.stderr)
    sys.exit(1)
