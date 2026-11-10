import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'backend-rust');
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  .match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error('Could not determine the Rust host target');

execFileSync('cargo', [
  'build', '--release',
  '--manifest-path', join(backend, 'Cargo.toml'),
  '--target-dir', join(backend, 'target'),
], { stdio: 'inherit' });

const extension = process.platform === 'win32' ? '.exe' : '';
const source = join(backend, 'target', 'release', `statsem-engine${extension}`);
const destination = join(root, 'src-tauri', 'binaries', `statsem-backend-${host}${extension}`);
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
if (process.platform !== 'win32') chmodSync(destination, 0o755);
console.log(`Prepared ${destination}`);
