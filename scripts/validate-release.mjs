import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const required = [
  'database/001_initial_schema.sql','database/011_production.sql','server/src/index.ts',
  'server/src/security.ts','server/src/storage.ts','client/src/App.tsx','client/Dockerfile','client/nginx.conf'
];
for (const file of required) if (!fs.existsSync(path.join(root,file))) throw new Error(`Missing required release file: ${file}`);
for (const forbidden of ['.env','node_modules','dist']) {
  if (fs.existsSync(path.join(root, forbidden))) throw new Error(`Release tree contains forbidden path: ${forbidden}`);
}
const env = fs.readFileSync(path.join(root,'.env.example'),'utf8');
if (/^JWT_SECRET=(?!replace-with-)/m.test(env)) throw new Error('Example environment appears to contain a real JWT secret.');
try { execFileSync('node',['--check','scripts/validate-release.mjs'],{stdio:'ignore'}); } catch { throw new Error('Node syntax validation failed.'); }
console.log('Release structure validation passed.');
