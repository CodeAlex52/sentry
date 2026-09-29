import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
      `export default ${JSON.stringify({categories, rules, ignorePatterns: ['static/ignored/*', '!static/ignored/keep.ts', 'node_modules/**'], overrides: [{files: ['static/internal/**'], rules: {'eslint/no-void': 'off'}}]})};\n`
    );
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'Synthetic fixture');
    return git('rev-parse', 'HEAD');
  };
  const run = (args: string[], status = 0, env: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'false',
        TMPDIR: path.join(root, 'scratch'),
        ...env,
      },
    });
    assert.equal(
      result.status,
      status,
      `${args.join(' ')}\n${result.stdout}\n${result.stderr}`
    );
    return result;
  };
  const check = (status = 0, base = 'HEAD', changed = false) =>
    JSON.parse(
      run(['check', '--base', base, '--json', ...(changed ? ['--changed'] : [])], status)
        .stdout
    );
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
    symlinkSync(tmpdir(), path.join(root, 'scratch'), 'dir');
    write('.gitignore', 'node_modules/\n/scratch\n.artifacts/\n');
    write('package.json', '{"type":"module"}\n');
    profile({});
    write('static/a.ts', 'void first();\nvoid second();\n');
    write('static/ignored/a.ts', 'void ignored();\n');
    write('static/internal/a.ts', 'void first();\n');
    write('static/ignored/keep.ts', 'export const kept = true;\n');
    commit();
    assert.deepEqual(check().occurrences, []);
    assert.match(run(['check', '--base', 'missing'], 2).stderr, /Cannot resolve/);
    assert.match(run(['check'], 2).stderr, /origin\/master/);
    run(['check', '--wat'], 2);
    run(['snapshot', '--base', 'HEAD'], 2);
    run(['snapshot', '--changed'], 2);
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
    const cacheDirectory = path.join(root, '.artifacts/lint-incubator/baselines');
    const cacheFiles = () =>
      readdirSync(cacheDirectory).filter(file => file.endsWith('.json'));
    assert.equal(cacheFiles().length, 1);
    const cacheFile = path.join(cacheDirectory, cacheFiles()[0]!);
    const cacheTime = statSync(cacheFile).mtimeMs;
    check();
    assert.equal(
      statSync(cacheFile).mtimeMs,
      cacheTime,
      'warm checks reuse the full baseline'
    );
    writeFileSync(cacheFile, '{"broken":true}');
    check();
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    assert.equal(
      cached.occurrences.length,
      2,
      'corrupt caches are replaced by a real scan'
    );
    profile({'eslint/no-void': 'error', 'eslint/no-console': 'error'});
    check();
    assert.equal(cacheFiles().length, 2, 'configuration changes invalidate the cache');
    profile();
    const poisoned = JSON.stringify({...cached, occurrences: []});
    writeFileSync(cacheFile, poisoned);
    run(['check', '--base', 'HEAD'], 0, {GITHUB_ACTIONS: 'true'});
    assert.equal(
      readFileSync(cacheFile, 'utf8'),
      poisoned,
      'CI neither reads nor writes local caches'
    );
    writeFileSync(cacheFile, JSON.stringify(cached));
    const backup = `${cacheDirectory}-backup`;
    renameSync(cacheDirectory, backup);
    writeFileSync(cacheDirectory, 'not a directory');
    check();
    rmSync(cacheDirectory);
    renameSync(backup, cacheDirectory);
    assert.equal(
      check(0, 'HEAD', true).scope,
      'full',
      'rule configuration changes require full scans'
    );
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
    const unchanged = check(0, 'HEAD', true);
    assert.equal(unchanged.scope, 'changed');
    assert.deepEqual(unchanged.occurrences, [], 'empty scope does not scan the tree');

    write('static/.gitignore', 'ignored/keep.ts\n');
    assert.equal(
      check(0, 'HEAD', true).scope,
      'full',
      'untracked nested ignore files require full scans'
    );
    rmSync(path.join(root, 'static/.gitignore'));
    write('package.json', '{"type":"module","private":true}\n');
    assert.equal(check(0, 'HEAD', true).scope, 'full');
    git('restore', 'package.json');

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
    assert.equal(
      check(0, 'HEAD', true).introduced.length,
      0,
      'changed-file scans preserve moves into untracked files'
    );
    write('static/copy.ts', 'void first();\n');
    const copied = check(1);
    assert.equal(copied.introduced.length, 1);
    assert.equal(
      copied.introduced[0].file,
      'static/copy.ts',
      'same-path allowance is consumed before matching moved statements'
    );
    assert.equal(check(1, 'HEAD', true).introduced[0].file, 'static/copy.ts');
    rmSync(path.join(root, 'static/copy.ts'));
    write('static/b.ts', 'void second();\nvoid second();\n');
    assert.equal(check(1).introduced.length, 1, 'each duplicate needs its own allowance');
    write('static/b.ts', 'void second();\n');
    commit();
    git('mv', 'static/b.ts', 'static/renamed.ts');
    const renamed = check(0, 'HEAD', true);
    assert.equal(renamed.occurrences.length, 1);
    assert.equal(renamed.introduced.length, 0, 'renames include both paths');
    git('mv', 'static/renamed.ts', 'static/b.ts');
    write('static/untracked copy.ts', 'void first();\n');
    assert.equal(
      check(1, 'HEAD', true).introduced.length,
      1,
      'an unchanged source cannot give its allowance to an untracked copy'
    );
    rmSync(path.join(root, 'static/untracked copy.ts'));
    write('static/a.ts', 'void   first();\n');
    assert.equal(
      check(1).introduced.length,
      1,
      'formatting inside a statement conservatively changes identity'
    );
    write('static/a.ts', '');
    assert.equal(check().introduced.length, 0);
    assert.equal(check(0, 'HEAD', true).introduced.length, 0);
    commit();
    write('static/a.ts', 'void first();\n');
    assert.equal(check(1).introduced.length, 1, 'cleaned debt cannot be reintroduced');
    assert.equal(check(1, 'HEAD', true).introduced.length, 1);

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
    git('update-ref', 'refs/remotes/origin/master', freshBase);
    git('checkout', '-q', 'stale');
    const local = JSON.parse(run(['check', '--json']).stdout);
    assert.equal(local.base, historical);
    assert.equal(
      local.introduced.length,
      0,
      'base-only cleanup is not attributed to a stale local branch'
    );
    assert.equal(
      check(1, 'origin/master').introduced.length,
      1,
      'an explicit base still compares the exact revision'
    );
    write('static/uncommitted.ts', 'void local();\n');
    assert.equal(
      JSON.parse(run(['check', '--changed', '--json'], 1).stdout).introduced.length,
      1,
      'local checks include untracked changes'
    );
    git('add', 'static/uncommitted.ts');
    assert.equal(
      JSON.parse(run(['check', '--changed', '--json'], 1).stdout).introduced.length,
      1,
      'local checks include staged changes'
    );
    write('static/uncommitted.ts', 'export const local = true;\n');
    assert.equal(
      JSON.parse(run(['check', '--changed', '--json']).stdout).introduced.length,
      0,
      'direct local checks include unstaged edits to staged files'
    );
    git('restore', '--staged', 'static/uncommitted.ts');
    rmSync(path.join(root, 'static/uncommitted.ts'));
    git('checkout', '-q', 'master');
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
    commit();
    for (const file of [
      '.gitignore',
      '.eslintignore',
      'static/.gitignore',
      '.oxlintignore',
    ]) {
      const originalIgnore =
        file === '.gitignore' ? readFileSync(path.join(root, file), 'utf8') : '';
      write(
        file,
        originalIgnore + (file.startsWith('static/') ? 'b.ts\n' : 'static/b.ts\n')
      );
      commit();
      check();
      write(file, originalIgnore);
      assert.equal(
        check().introduced.length,
        0,
        `un-ignoring existing debt in ${file} uses current policy on both scans`
      );
      if (file !== '.gitignore') {
        rmSync(path.join(root, file));
        assert.equal(
          check().introduced.length,
          0,
          `deleted ${file} stays deleted in base`
        );
      }
      commit();
    }
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('prefer-primitives is an incubator tenant with exact-base cleanup and exclusions', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'prefer-primitives-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (file: string, contents: string) => {
    mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    writeFileSync(path.join(root, file), contents);
  };
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'Synthetic primitive fixture');
  };
  const check = (status = 0) => {
    const result = spawnSync(
      process.execPath,
      [cli, 'check', '--base', 'HEAD', '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {...process.env, GITHUB_ACTIONS: 'false'},
      }
    );
    assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout);
  };
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
    mkdirSync(path.join(root, 'static/oxlint'), {recursive: true});
    symlinkSync(
      path.join(project, 'static/oxlint/eslintPluginScraps'),
      path.join(root, 'static/oxlint/eslintPluginScraps'),
      'dir'
    );
    write('.gitignore', 'node_modules/\n');
    write('package.json', '{"type":"module"}\n');
    const rule = '@sentry/scraps/prefer-primitives';
    write(
      'oxlint.config.incubator.ts',
      `export default ${JSON.stringify({
        categories,
        jsPlugins: [
          {
            name: '@sentry/scraps',
            specifier: './static/oxlint/eslintPluginScraps/index.ts',
          },
        ],
        ignorePatterns: ['static/oxlint/**'],
        rules: {[rule]: 'error'},
        overrides: [{files: ['static/app/components/core/**'], rules: {[rule]: 'off'}}],
      })};\n`
    );
    const oldSource = 'const View = <div style={{display:"flex",gap:8}}/>;\n';
    const internalSource = 'const Internal = <div style={{display:"grid"}}/>;\n';
    write('static/old.tsx', oldSource);
    write('static/app/components/core/internal.tsx', internalSource);
    commit();
    const unchanged = check();
    assert.equal(unchanged.occurrences.length, 1);
    assert.equal(unchanged.occurrences[0].rule, rule);
    assert.deepEqual(unchanged.introduced, []);
    write('static/copied-internal.tsx', internalSource);
    assert.equal(
      check(1).introduced.length,
      1,
      'excluded primitive source cannot pay for a new external occurrence'
    );
    rmSync(path.join(root, 'static/copied-internal.tsx'));
    write('static/copy.tsx', oldSource);
    assert.equal(
      check(1).introduced.length,
      1,
      'copying a style definition creates new debt'
    );
    rmSync(path.join(root, 'static/copy.tsx'));
    write(
      'static/old.tsx',
      "import {Flex} from '@sentry/scraps/layout'; const View = <Flex gap='md'/>;\n"
    );
    assert.deepEqual(check().occurrences, []);
    commit();
    write('static/old.tsx', oldSource);
    assert.equal(check(1).introduced.length, 1, 'cleaned primitive debt cannot return');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
