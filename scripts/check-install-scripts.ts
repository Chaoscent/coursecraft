// SPDX-License-Identifier: Apache-2.0
/**
 * Every installed package that ships a lifecycle install script (or a
 * binding.gyp, which triggers an implicit node-gyp build) must have an explicit
 * decision in pnpm-workspace.yaml (`allowBuilds`) and a justification in
 * docs/dependencies.md. pnpm itself refuses to run unlisted scripts
 * (`strictDepBuilds`); this check also catches denied-but-undocumented ones.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'] as const;
const STORE = 'node_modules/.pnpm';

const manifest = z.object({ name: z.string(), scripts: z.record(z.string(), z.string()).optional() }).loose();

function* packageDirs(): Generator<string> {
  for (const entry of readdirSync(STORE)) {
    const modules = join(STORE, entry, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules)) {
      if (name === '.bin') continue;
      if (name.startsWith('@')) {
        for (const sub of readdirSync(join(modules, name))) yield join(modules, name, sub);
      } else {
        yield join(modules, name);
      }
    }
  }
}

const withScripts = new Map<string, string[]>();
for (const dir of packageDirs()) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = manifest.parse(JSON.parse(readFileSync(file, 'utf8')));
  const hooks: string[] = INSTALL_HOOKS.filter((hook) => pkg.scripts?.[hook]);
  if (!hooks.length && existsSync(join(dir, 'binding.gyp'))) hooks.push('binding.gyp');
  if (hooks.length) withScripts.set(pkg.name, hooks);
}

const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
const allowBlock = workspace.split(/^allowBuilds:\s*$/m)[1] ?? '';
const decided = new Set(
  [...allowBlock.matchAll(/^ {2}'?([@\w./-]+)'?:\s*(true|false)\s*$/gm)].map((m) => m[1]),
);
const strict = /^strictDepBuilds:\s*true\s*$/m.test(workspace);
const docs = readFileSync('docs/dependencies.md', 'utf8');

const problems: string[] = [];
if (!strict) problems.push('pnpm-workspace.yaml must set strictDepBuilds: true');
for (const [name, hooks] of [...withScripts].sort()) {
  if (!decided.has(name)) problems.push(`${name} (${hooks.join(', ')}): no allowBuilds decision`);
  if (!docs.includes(`\`${name}\``)) problems.push(`${name}: not justified in docs/dependencies.md`);
}

if (problems.length) {
  console.error(`Install-script check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Install-script check passed: ${withScripts.size} packages with install scripts, all decided.`);
