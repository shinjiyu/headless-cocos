// Vendored from Cocos Creator engine (notepack) for headless CCON v2.
'use strict';
let __exports = {};
function __register(_name, _deps, factory) {
  const mod = factory((k, v) => {
    if (typeof k === 'object') Object.assign(__exports, k);
    else __exports[k] = v;
  }, {});
  if (mod && typeof mod.execute === 'function') mod.execute();
}
const System = { register: __register };
System.register("q-bundled:///fs/external/deserialize/notepack_decode.js", [], function (_export, _context) {
  "use strict";

  var Decoder;
  function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
  function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
  function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
  function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return typeof key === "symbol" ? key : String(key); }
  function _toPrimitive(input, hint) { if (typeof input !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (typeof res !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
  function utf8Read(view, offset, length) {
    var string = '';
    var chr = 0;
    for (var i = offset, end = offset + length; i < end; i++) {
      var _byte = view.getUint8(i);
      if ((_byte & 0x80) === 0x00) {
        string += String.fromCharCode(_byte);
        continue;
      }
      if ((_byte & 0xe0) === 0xc0) {
        string += String.fromCharCode((_byte & 0x1f) << 6 | view.getUint8(++i) & 0x3f);
        continue;
      }
      if ((_byte & 0xf0) === 0xe0) {
        string += String.fromCharCode((_byte & 0x0f) << 12 | (view.getUint8(++i) & 0x3f) << 6 | (view.getUint8(++i) & 0x3f) << 0);
        continue;
      }
      if ((_byte & 0xf8) === 0xf0) {
        chr = (_byte & 0x07) << 18 | (view.getUint8(++i) & 0x3f) << 12 | (view.getUint8(++i) & 0x3f) << 6 | (view.getUint8(++i) & 0x3f) << 0;
        if (chr >= 0x010000) {
          // surrogate pair
          chr -= 0x010000;
          string += String.fromCharCode((chr >>> 10) + 0xD800, (chr & 0x3FF) + 0xDC00);
        } else {
          string += String.fromCharCode(chr);
        }
        continue;
      }
      throw new Error("Invalid byte " + _byte.toString(16));
    }
    return string;
  }
  function notepackDecode(buffer) {
    var decoder = new Decoder(buffer);
    var value = decoder.parse();
    if (decoder.offset !== buffer.byteLength) {
      throw new Error(buffer.byteLength - decoder.offset + " trailing bytes");
    }
    return value;
  }
  _export("notepackDecode", notepackDecode);
  return {
    setters: [],
    execute: function () {
      /*
       * Copyright (c) 2014 Ion Drive Software Ltd.
       * Copyright (c) 2025 Xiamen Yaji Software Co., Ltd.
       *
       * Permission is hereby granted, free of charge, to any person obtaining a copy
       * of this software and associated documentation files (the "Software"), to deal
       * in the Software without restriction, including without limitation the rights
       * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
       * copies of the Software, and to permit persons to whom the Software is
       * furnished to do so, subject to the following conditions:
       *
       * The above copyright notice and this permission notice shall be included in all
       * copies or substantial portions of the Software.
       *
       * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
       * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
       * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
       * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
       * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
       * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
       * SOFTWARE.
       */
      Decoder = /*#__PURE__*/function () {
        function Decoder(buffer) {
          this._offset = 0;
          this._buffer = void 0;
          this._view = void 0;
          if (buffer instanceof ArrayBuffer) {
            this._buffer = buffer;
            this._view = new DataView(this._buffer);
          } else if (ArrayBuffer.isView(buffer)) {
            this._buffer = buffer.buffer;
            this._view = new DataView(this._buffer, buffer.byteOffset, buffer.byteLength);
          } else {
            throw new Error('Invalid argument');
          }
        }
        var _proto = Decoder.prototype;
        _proto._array = function _array(length) {
          var value = new Array(length);
          for (var i = 0; i < length; i++) {
            value[i] = this.parse();
          }
          return value;
        };
        _proto._map = function _map(length) {
          var key = '';
          var value = {};
          for (var i = 0; i < length; i++) {
            key = this.parse();
            value[key] = this.parse();
          }
          return value;
        };
        _proto._str = function _str(length) {
          var value = utf8Read(this._view, this._offset, length);
          this._offset += length;
          return value;
        };
        _proto._bin = function _bin(length) {
          var value = this._buffer.slice(this._offset, this._offset + length);
          this._offset += length;
          return value;
        };
        _proto.parse = function parse() {
          var prefix = this._view.getUint8(this._offset++);
          var value;
          var length = 0;
          var type = 0;
          var hi = 0;
          var lo = 0;
          if (prefix < 0xc0) {
            // positive fixint
            if (prefix < 0x80) {
              return prefix;
            }
            // fixmap
            if (prefix < 0x90) {
              return this._map(prefix & 0x0f);
            }
            // fixarray
            if (prefix < 0xa0) {
              return this._array(prefix & 0x0f);
            }
            // fixstr
            return this._str(prefix & 0x1f);
          }

          // negative fixint
          if (prefix > 0xdf) {
            return (0xff - prefix + 1) * -1;
          }
          switch (prefix) {
            // nil
            case 0xc0:
              return null;
            // false
            case 0xc2:
              return false;
            // true
            case 0xc3:
              return true;

            // bin
            case 0xc4:
              length = this._view.getUint8(this._offset);
              this._offset += 1;
              return this._bin(length);
            case 0xc5:
              length = this._view.getUint16(this._offset);
              this._offset += 2;
              return this._bin(length);
            case 0xc6:
              length = this._view.getUint32(this._offset);
              this._offset += 4;
              return this._bin(length);

            // ext
            case 0xc7:
              length = this._view.getUint8(this._offset);
              type = this._view.getInt8(this._offset + 1);
              this._offset += 2;
              if (type === -1) {
                // timestamp 96
                var ns = this._view.getUint32(this._offset);
                hi = this._view.getInt32(this._offset + 4);
                lo = this._view.getUint32(this._offset + 8);
                this._offset += 12;
                return new Date((hi * 0x100000000 + lo) * 1e3 + ns / 1e6);
              }
              return [type, this._bin(length)];
            case 0xc8:
              length = this._view.getUint16(this._offset);
              type = this._view.getInt8(this._offset + 2);
              this._offset += 3;
              return [type, this._bin(length)];
            case 0xc9:
              length = this._view.getUint32(this._offset);
              type = this._view.getInt8(this._offset + 4);
              this._offset += 5;
              return [type, this._bin(length)];

            // float
            case 0xca:
              value = this._view.getFloat32(this._offset);
              this._offset += 4;
              return value;
            case 0xcb:
              value = this._view.getFloat64(this._offset);
              this._offset += 8;
              return value;

            // uint
            case 0xcc:
              value = this._view.getUint8(this._offset);
              this._offset += 1;
              return value;
            case 0xcd:
              value = this._view.getUint16(this._offset);
              this._offset += 2;
              return value;
            case 0xce:
              value = this._view.getUint32(this._offset);
              this._offset += 4;
              return value;
            case 0xcf:
              hi = this._view.getUint32(this._offset) * Math.pow(2, 32);
              lo = this._view.getUint32(this._offset + 4);
              this._offset += 8;
              return hi + lo;

            // int
            case 0xd0:
              value = this._view.getInt8(this._offset);
              this._offset += 1;
              return value;
            case 0xd1:
              value = this._view.getInt16(this._offset);
              this._offset += 2;
              return value;
            case 0xd2:
              value = this._view.getInt32(this._offset);
              this._offset += 4;
              return value;
            case 0xd3:
              hi = this._view.getInt32(this._offset) * Math.pow(2, 32);
              lo = this._view.getUint32(this._offset + 4);
              this._offset += 8;
              return hi + lo;

            // fixext
            case 0xd4:
              type = this._view.getInt8(this._offset);
              this._offset += 1;
              if (type === 0x00) {
                // custom encoding for 'undefined' (kept for backward-compatibility)
                this._offset += 1;
                return undefined;
              }
              return [type, this._bin(1)];
            case 0xd5:
              type = this._view.getInt8(this._offset);
              this._offset += 1;
              return [type, this._bin(2)];
            case 0xd6:
              type = this._view.getInt8(this._offset);
              this._offset += 1;
              if (type === -1) {
                // timestamp 32
                value = this._view.getUint32(this._offset);
                this._offset += 4;
                return new Date(value * 1e3);
              }
              return [type, this._bin(4)];
            case 0xd7:
              type = this._view.getInt8(this._offset);
              this._offset += 1;
              if (type === 0x00) {
                // custom date encoding (kept for backward-compatibility)
                hi = this._view.getInt32(this._offset) * Math.pow(2, 32);
                lo = this._view.getUint32(this._offset + 4);
                this._offset += 8;
                return new Date(hi + lo);
              }
              if (type === -1) {
                // timestamp 64
                hi = this._view.getUint32(this._offset);
                lo = this._view.getUint32(this._offset + 4);
                this._offset += 8;
                var s = (hi & 0x3) * 0x100000000 + lo;
                return new Date(s * 1e3 + (hi >>> 2) / 1e6);
              }
              return [type, this._bin(8)];
            case 0xd8:
              type = this._view.getInt8(this._offset);
              this._offset += 1;
              return [type, this._bin(16)];

            // str
            case 0xd9:
              length = this._view.getUint8(this._offset);
              this._offset += 1;
              return this._str(length);
            case 0xda:
              length = this._view.getUint16(this._offset);
              this._offset += 2;
              return this._str(length);
            case 0xdb:
              length = this._view.getUint32(this._offset);
              this._offset += 4;
              return this._str(length);

            // array
            case 0xdc:
              length = this._view.getUint16(this._offset);
              this._offset += 2;
              return this._array(length);
            case 0xdd:
              length = this._view.getUint32(this._offset);
              this._offset += 4;
              return this._array(length);

            // map
            case 0xde:
              length = this._view.getUint16(this._offset);
              this._offset += 2;
              return this._map(length);
            case 0xdf:
              length = this._view.getUint32(this._offset);
              this._offset += 4;
              return this._map(length);
            default:
          }
          throw new Error('Could not parse');
        };
        _createClass(Decoder, [{
          key: "offset",
          get: function get() {
            return this._offset;
          }
        }]);
        return Decoder;
      }();
    }
  };
});
module.exports = __exports;
