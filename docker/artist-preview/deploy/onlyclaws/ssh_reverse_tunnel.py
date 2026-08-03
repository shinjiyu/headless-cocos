#!/usr/bin/env python3
"""
SSH reverse tunnel: VPS 127.0.0.1:<port> -> local artist-preview Docker.

Required env:
  ONLYCLAWS_PASS
  ONLYCLAWS_HOST
Optional:
  ONLYCLAWS_USER / ONLYCLAWS_PSD_PORT / ONLYCLAWS_PUBLIC_BASE
"""
import os
import select
import socket
import sys
import threading

import paramiko

HOST = os.environ.get('ONLYCLAWS_HOST', '').strip()
USER = os.environ.get('ONLYCLAWS_USER', 'root')
PASSWORD = os.environ['ONLYCLAWS_PASS']
PORT = int(os.environ.get('ONLYCLAWS_PSD_PORT', '8810'))
PUBLIC_BASE = os.environ.get('ONLYCLAWS_PUBLIC_BASE', '').rstrip('/')
REMOTE_BIND = ('127.0.0.1', PORT)
LOCAL_TARGET = ('127.0.0.1', PORT)


def send_all_channel(chan, data: bytes) -> None:
  view = memoryview(data)
  while len(view):
    sent = chan.send(view)
    if sent == 0:
      raise BrokenPipeError('SSH channel closed during send')
    view = view[sent:]


def pipe(sock, chan):
  try:
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
  except OSError:
    pass
  try:
    while True:
      readable, _, _ = select.select([sock, chan], [], [], 60)
      if not readable:
        if not chan.transport or not chan.transport.is_active():
          break
        continue
      if sock in readable:
        data = sock.recv(65536)
        if not data:
          try:
            chan.shutdown_write()
          except Exception:
            pass
          while chan.recv_ready():
            more = chan.recv(65536)
            if not more:
              break
            sock.sendall(more)
          break
        send_all_channel(chan, data)
      if chan in readable:
        data = chan.recv(65536)
        if not data:
          try:
            sock.shutdown(socket.SHUT_WR)
          except Exception:
            pass
          break
        sock.sendall(data)
  finally:
    try:
      chan.close()
    except Exception:
      pass
    try:
      sock.close()
    except Exception:
      pass


def accept_loop(transport):
  while True:
    chan = transport.accept(10)
    if chan is None:
      if not transport.is_active():
        break
      continue
    try:
      sock = socket.create_connection(LOCAL_TARGET, timeout=10)
    except OSError as e:
      print(f'local connect failed: {e}', file=sys.stderr, flush=True)
      try:
        chan.close()
      except Exception:
        pass
      continue
    threading.Thread(target=pipe, args=(sock, chan), daemon=True).start()


def main():
  if not HOST:
    raise SystemExit('ONLYCLAWS_HOST is required')

  print('checking local portal...', flush=True)
  try:
    s = socket.create_connection(LOCAL_TARGET, timeout=2)
    s.close()
    print('local portal ok', flush=True)
  except OSError as e:
    print(
      f'Local portal not reachable at {LOCAL_TARGET}: {e}',
      file=sys.stderr,
      flush=True,
    )
    sys.exit(2)

  print(f'connecting to {HOST}...', flush=True)
  client = paramiko.SSHClient()
  client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
  client.connect(HOST, username=USER, password=PASSWORD, timeout=25)
  print('ssh connected', flush=True)
  transport = client.get_transport()
  transport.set_keepalive(30)
  print(f'requesting remote forward {REMOTE_BIND}...', flush=True)
  transport.request_port_forward(REMOTE_BIND[0], REMOTE_BIND[1])
  print(
    f'Tunnel up: {HOST}:{REMOTE_BIND[1]} -> local {LOCAL_TARGET[0]}:{LOCAL_TARGET[1]}',
    flush=True,
  )
  pub = PUBLIC_BASE or f'https://{HOST}/psd'
  print(f'Public URL: {pub}/', flush=True)
  try:
    accept_loop(transport)
  finally:
    client.close()
    print('tunnel closed', flush=True)


if __name__ == '__main__':
  main()
