import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
function compress(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compress(path);
    else if (/\.(js|css|html|json|svg)$/.test(path)) {
      const content = readFileSync(path);
      writeFileSync(path + '.br', brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      writeFileSync(path + '.gz', gzipSync(content, { level: 9 }));
    }
  }
}
compress('dist');
console.log('Assets estáticos preparados em Brotli e gzip.');
