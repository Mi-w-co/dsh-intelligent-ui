/**
 * Package the built plugin into a single distributable zip.
 *
 * The runtime half of the plugin is a directory DSH installs whole, so the zip
 * holds exactly what an install needs — `lib/`, the manifest, the bundle patch
 * and the README — and nothing from the source tree. The build outputs must
 * already exist, so this never ships a stale bundle.
 *
 * Run after `node tools/build-client.mjs` and `node tools/build-prompt.mjs`:
 *
 *   node tools/pack.mjs            # -> dist/dsh-intelligent-ui-<version>.zip
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'lib/index.js',
  'lib/client.js',
  'lib/prompt.js',
  'lib/prompt-text.js',
];

for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`missing ${file} — run the build scripts first`);
    process.exit(1);
  }
}

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const zipPath = path.join(dist, `${manifest.name}-${manifest.version}.zip`);
fs.rmSync(zipPath, { force: true });

// Stage under the package name so the zip extracts into a ready-to-install
// directory instead of spilling files into the current one.
const stage = fs.mkdtempSync(path.join(dist, '.stage-'));
const pkgDir = path.join(stage, manifest.name);
for (const file of files) {
  const dest = path.join(pkgDir, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, file), dest);
}

// Write the zip directly: a bare `node` may be a stripped runtime without
// PowerShell's Archive module or a `zip` binary, and a plain STORE (uncompressed)
// archive is all an install needs. `client.js` is already minified, so the
// difference in size is negligible.
const entries = [];
for (const file of files) {
  const data = fs.readFileSync(path.join(root, file));
  entries.push({ name: `${manifest.name}/${file}`, data });
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const local = [];
const central = [];
let offset = 0;
const dosTime = ((14 << 11) | (0 << 5) | 0) & 0xffff; // 00:00:00
const dosDate = (((2026 - 1980) << 9) | (1 << 5) | 1) & 0xffff; // 2026-01-01
for (const entry of entries) {
  const name = Buffer.from(entry.name, 'utf8');
  const crc = crc32(entry.data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(0x0800, 6); // UTF-8 names
  head.writeUInt16LE(0, 8); // stored
  head.writeUInt16LE(dosTime, 10);
  head.writeUInt16LE(dosDate, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(entry.data.length, 18);
  head.writeUInt32LE(entry.data.length, 22);
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28);
  local.push(head, name, entry.data);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4); // version made by
  dir.writeUInt16LE(20, 6); // version needed
  dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(0, 10); // stored
  dir.writeUInt16LE(dosTime, 12);
  dir.writeUInt16LE(dosDate, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(entry.data.length, 20);
  dir.writeUInt32LE(entry.data.length, 24);
  dir.writeUInt16LE(name.length, 28);
  dir.writeUInt16LE(0, 30); // extra
  dir.writeUInt16LE(0, 32); // comment
  dir.writeUInt16LE(0, 34); // disk
  dir.writeUInt16LE(0, 36); // internal attrs
  dir.writeUInt32LE(0, 38); // external attrs
  dir.writeUInt32LE(offset, 42);
  central.push(dir, name);
  offset += head.length + name.length + entry.data.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
fs.writeFileSync(zipPath, Buffer.concat([...local, centralBuf, end]));

fs.rmSync(stage, { recursive: true, force: true });
const size = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
console.log(`wrote ${path.relative(root, zipPath)}  ${size} MB`);
