import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(project, 'scripts/lint-incubator.ts');
const categories = {
  correctness: 'off',
  suspicious: 'off',
  pedantic: 'off',
  perf: 'off',
  style: 'off',
  restriction: 'off',
  nursery: 'off',
};

test('incubator compares real oxlint occurrences against exact Git source', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lint-incubator-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (file: string, contents: string) => {
    mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    writeFileSync(path.join(root, file), contents);
  };
  const profile = (rules: Record<string, string> = {'eslint/no-void': 'error'}) =>
    write(
      'oxlint.config.incubator.ts',
      `export default ${JSON.stringify({categories, rules, ignorePatterns: ['static/ignored/*', '!static/ignored/keep.ts', 'node_modules/**']})};\n`
    );
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'Synthetic fixture');
    return git('rev-parse', 'HEAD');
  };
  const run = (args: string[], status = 0) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {...process.env, GITHUB_ACTIONS: 'false'},
    });
    assert.equal(
      result.status,
      status,
      `${args.join(' ')}\n${result.stdout}\n${result.stderr}`
    );
    return result;
  };
  const check = (status = 0, base = 'HEAD') =>
    JSON.parse(run(['check', '--base', base, '--json'], status).stdout);
  try {
    git('init', '-q', '-b', 'master');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', '/dev/null');
    git('config', 'user.name', 'Incubator Test');
    git('config', 'user.email', 'test@example.com');
    symlinkSync(
      path.join(project, 'node_modules'),
      path.join(root, 'node_modules'),
      'dir'
    );
    write('.gitignore', 'node_modules/\n');
    write('package.json', '{"type":"module"}\n');
    profile({});
    write('static/a.ts', 'void first();\nvoid second();\n');
    write('static/ignored/a.ts', 'void ignored();\n');
    write('static/ignored/keep.ts', 'export const kept = true;\n');
    commit();
    assert.deepEqual(check().occurrences, []);
    assert.match(run(['check', '--base', 'missing'], 2).stderr, /Cannot resolve/);
    assert.match(run(['check'], 2).stderr, /origin\/master/);
    run(['check', '--wat'], 2);
    run(['snapshot', '--base', 'HEAD'], 2);
    run(['check', '--rule', 'eslint/no-void'], 2);
    run(['backlog', '--rule', 'unknown'], 2);
    run(['check', '--base', ''], 2);
    run(['check', 'extra'], 2);
    run(['check', '--base', 'HEAD', '--base', 'HEAD'], 2);

    profile();
    const enrolled = check();
    assert.equal(
      enrolled.occurrences.length,
      2,
      'first enrollment scans base with the current rule configuration and ignores ignored files'
    );
    assert.equal(enrolled.introduced.length, 0);
    assert.equal(JSON.parse(run(['snapshot']).stdout).occurrences.length, 2);
    const backlog = JSON.parse(
      run(['backlog', '--rule', 'eslint/no-void', '--file', 'static/a.ts']).stdout
    );
    assert.equal(backlog.occurrences.length, 2);
    assert(
      backlog.occurrences.every(
        (item: {file: string; rule: string}) =>
          item.file === 'static/a.ts' && item.rule === 'eslint/no-void'
      )
    );
    assert.deepEqual(
      JSON.parse(run(['backlog', '--file', 'static/missing.ts', '--json']).stdout)
        .occurrences,
      []
    );
    write('static/ignored/keep.ts', 'void kept();\n');
    assert.equal(check(1).introduced.length, 1, 'negated ignores apply on both scans');
    write('static/ignored/keep.ts', 'export const kept = true;\n');
    commit();

    write('static/a.ts', '\n\nvoid first();\nvoid second();\n');
    assert.equal(
      check().introduced.length,
      0,
      'inserted blank lines keep source identities'
    );
    write('static/a.ts', 'void first();\nvoid replacement();\n');
    assert.equal(check(1).introduced.length, 1, 'same-count replacement is new debt');
    write('static/a.ts', 'void first();\nvoid second();\nvoid third();\n');
    assert.equal(check(1).introduced.length, 1);
    write('static/a.ts', 'void first();\n');
    write('static/b.ts', 'void second();\n');
    assert.equal(
      check().introduced.length,
      0,
      'splitting a file preserves unchanged statements'
    );
    write('static/copy.ts', 'void first();\n');
    const copied = check(1);
    assert.equal(copied.introduced.length, 1);
    assert.equal(
      copied.introduced[0].file,
      'static/copy.ts',
      'same-path allowance is consumed before matching moved statements'
    );
    rmSync(path.join(root, 'static/copy.ts'));
    write('static/b.ts', 'void second();\nvoid second();\n');
    assert.equal(check(1).introduced.length, 1, 'each duplicate needs its own allowance');
    write('static/b.ts', 'void second();\n');
    commit();
    write('static/a.ts', 'void   first();\n');
    assert.equal(
      check(1).introduced.length,
      1,
      'formatting inside a statement conservatively changes identity'
    );
    write('static/a.ts', '');
    assert.equal(check().introduced.length, 0);
    commit();
    write('static/a.ts', 'void first();\n');
    assert.equal(check(1).introduced.length, 1, 'cleaned debt cannot be reintroduced');

    rmSync(path.join(root, 'static/a.ts'));
    write(
      'static/unicode.tsx',
      'const emoji = "😀"; void first();\nconst jsx = <span>{void second()}</span>;\nconst re = /[a b]/; const t = `a b`;\n'
    );
    commit();
    const unicode = check();
    assert.equal(
      unicode.occurrences.filter(
        (item: {file: string}) => item.file === 'static/unicode.tsx'
      ).length,
      2
    );
    const original = readFileSync(path.join(root, 'static/unicode.tsx'), 'utf8');
    write('static/unicode.tsx', `\n${original}`);
    assert.equal(
      check().introduced.length,
      0,
      'UTF-8 spans remain stable after blank lines in TSX'
    );
    write(
      'static/unicode.tsx',
      original.replace('<span>', '<div>').replace('</span>', '</div>')
    );
    assert.equal(check(1).introduced.length, 1, 'changed JSX context is new identity');
    write('static/unicode.tsx', 'const broken = ;\n');
    assert.match(run(['check', '--base', 'HEAD'], 2).stderr, /oxlint|parser/i);
    git('restore', 'static/unicode.tsx');

    const historical = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'stale');
    write('static/branch.ts', 'export const branch = true;\n');
    commit();
    git('checkout', '-q', 'master');
    write('static/b.ts', '');
    const freshBase = commit();
    git('merge', '--no-ff', '-qm', 'Synthetic PR merge', 'stale');
    assert.equal(git('rev-parse', 'HEAD^1'), freshBase);
    write('static/b.ts', 'void second();\n');
    assert.equal(
      check(0, historical).introduced.length,
      0,
      'historical branch base incorrectly tolerates restored debt'
    );
    assert.equal(
      check(1, 'HEAD^1').introduced.length,
      1,
      'exact synthetic merge parent detects restored debt'
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
