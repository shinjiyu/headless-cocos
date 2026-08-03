import Busboy from 'busboy';

/**
 * Normalize multipart filename to UTF-8 (fix latin1 mojibake if needed).
 * @param {string} raw
 */
export function decodeUploadFilename(raw) {
  if (!raw) return '';
  const name = String(raw).replace(/^.*[/\\]/, '');
  // Already looks like proper CJK / printable UTF-8
  if (/[\u4e00-\u9fff]/.test(name)) return name;
  // Classic: UTF-8 bytes misread as latin1 → "Hçº¿-èµ…"
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\uFFFD') && /[\u4e00-\u9fff]/.test(fixed)) {
      return fixed;
    }
  } catch {
    /* keep original */
  }
  return name;
}

/**
 * Parse multipart/form-data; expect a single file field named `file`.
 * @param {import('node:http').IncomingMessage} req
 * @param {{maxBytes?: number}} [opts]
 * @returns {Promise<{buffer: Buffer, filename: string, mime: string}>}
 */
export function parsePsdUpload(req, opts = {}) {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.toLowerCase().includes('multipart/form-data')) {
      reject(Object.assign(new Error('Content-Type must be multipart/form-data'), {
        statusCode: 415,
      }));
      return;
    }

    let settled = false;
    /** @type {Buffer[]} */
    const chunks = [];
    let filename = '';
    let mime = '';
    let total = 0;
    let sawFile = false;

    // Chrome 等浏览器对 filename 发 UTF-8 字节；busboy 默认按 latin1 解会成乱码
    const bb = Busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: { files: 1, fileSize: maxBytes },
    });

    bb.on('file', (fieldname, stream, info) => {
      if (fieldname !== 'file') {
        stream.resume();
        return;
      }
      sawFile = true;
      filename = decodeUploadFilename(info.filename) || 'upload.psd';
      mime = info.mimeType || 'application/octet-stream';
      stream.on('data', (d) => {
        total += d.length;
        if (total > maxBytes) {
          stream.destroy();
          if (!settled) {
            settled = true;
            reject(Object.assign(new Error(`file exceeds ${maxBytes} bytes`), {
              statusCode: 413,
            }));
          }
          return;
        }
        chunks.push(d);
      });
      stream.on('limit', () => {
        if (!settled) {
          settled = true;
          reject(Object.assign(new Error(`file exceeds ${maxBytes} bytes`), {
            statusCode: 413,
          }));
        }
      });
    });

    bb.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    bb.on('finish', () => {
      if (settled) return;
      settled = true;
      if (!sawFile) {
        reject(Object.assign(new Error('missing multipart field "file"'), {
          statusCode: 400,
        }));
        return;
      }
      resolve({
        buffer: Buffer.concat(chunks),
        filename,
        mime,
      });
    });

    req.pipe(bb);
  });
}
