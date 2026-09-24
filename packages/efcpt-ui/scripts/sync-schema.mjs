// Copies samples/efcpt-config.schema.json into the package and generates TypeScript types from it.
// Usage: node scripts/sync-schema.mjs [--check]   (--check fails if the committed copies are out of date)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compile } from 'json-schema-to-typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.resolve(root, '../../samples/efcpt-config.schema.json');
const schemaOut = path.join(root, 'schema/efcpt-config.schema.json');
const typesOut = path.join(root, 'src/config/efcpt-config.generated.ts');
const check = process.argv.includes('--check');

const schemaText = (await readFile(source, 'utf8')).replace(/^\uFEFF/, '');
const schema = JSON.parse(schemaText);

const types = await compile(schema, 'EfcptConfig', {
  bannerComment:
    '/* Generated from samples/efcpt-config.schema.json by scripts/sync-schema.mjs. Do not edit. */',
  additionalProperties: true,
  style: { singleQuote: true, printWidth: 110 },
});

const outputs = [
  [schemaOut, schemaText],
  [typesOut, types],
];

let stale = false;
for (const [file, content] of outputs) {
  const current = await readFile(file, 'utf8').catch(() => null);
  if (current === content) continue;
  if (check) {
    console.error(`${path.relative(root, file)} is out of date, run: npm run sync-schema`);
    stale = true;
  } else {
    await writeFile(file, content);
    console.log(`updated ${path.relative(root, file)}`);
  }
}

process.exit(stale ? 1 : 0);
