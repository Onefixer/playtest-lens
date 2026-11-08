// Playtest Lens - minimal ZIP reader for the zips testers export with F9.
// Handles stored and deflated entries using the browser's DecompressionStream.
(function () {
  'use strict';
  const PL = (window.PL = window.PL || {});

  PL.unzip = async function (buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('This file is not a zip archive.');
    const count = view.getUint16(end + 10, true);
    let p = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLength = view.getUint16(p + 28, true);
      const extraLength = view.getUint16(p + 30, true);
      const commentLength = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
      p += 46 + nameLength + extraLength + commentLength;
      if (name.endsWith('/')) continue;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      entries.push({ name, method, data: bytes.subarray(start, start + size) });
    }
    const files = [];
    for (const entry of entries) {
      if (entry.method === 0) files.push({ name: entry.name, data: entry.data.slice() });
      else if (entry.method === 8) files.push({ name: entry.name, data: await inflate(entry.data) });
    }
    return files;
  };

  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot unzip files. Unzip the file and drop the folder instead.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
})();
