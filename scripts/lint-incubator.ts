import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

import ts from 'typescript';
import {z} from 'zod';

const diagnosticSchema = z.object({
  message: z.string(),
  code: z.string(),
  filename: z.string(),
  help: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  labels: z
    .array(
      z.object({
        span: z.object({
          offset: z.number().int().nonnegative(),
          length: z.number().int().nonnegative(),
          line: z.number().int().positive(),
          column: z.number().int().positive(),
        }),
      })
    )
    .min(1),
});

const occurrenceSchema = z.object({
  column: z.number().int().positive(),
  file: z
    .string()
    .refine(file => file.startsWith('static/') && !file.split('/').includes('..')),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  help: z.string().nullable(),
  line: z.number().int().positive(),
  message: z.string(),
  rule: z.string(),
  url: z.string().nullable(),
});
const inventorySchema = z.object({
  occurrences: z.array(occurrenceSchema),
  revision: z.string(),
  rules: z.array(z.string()),
  schemaVersion: z.literal(1),
});
type Occurrence = z.infer<typeof occurrenceSchema>;
type Inventory = z.infer<typeof inventorySchema>;

function git(root: string, args: string[]) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveRevision(root: string, ref: string) {
  try {
    return git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  } catch {
    throw new Error(
      `Cannot resolve base/revision ${JSON.stringify(ref)}. Fetch origin/master or pass --base with an available commit.`
    );
  }
}

function defaultBase(root: string, revision: string) {
  const master = resolveRevision(root, 'origin/master');
  const bases = git(root, ['merge-base', '--all', revision, master]).split('\n');
  assert(
    bases.length === 1 && bases[0],
    'Cannot determine a unique merge base with origin/master. Pass --base explicitly.'
  );
  return bases[0];
}

function changedFiles(root: string, base: string): string[] | undefined {
  const files = [
    ...new Set(
      [
        git(root, ['diff', '--name-only', '--no-renames', '-z', base, '--']),
        git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
      ]
        .flatMap(output => output.split('\0'))
        .filter(Boolean)
    ),
  ];
  if (
    files.some(
      file =>
        /(^|\/)(?:\.gitignore|\.eslintignore|\.oxlintignore|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^/]*)?\.json)$/.test(
          file
        ) ||
        /^(?:oxlint\.|static\/oxlint\/|scripts\/lint-incubator(?:\.test)?\.ts$|\.node-version$)/.test(
          file
        )
    )
  ) {
    return undefined;
  }
  const sources = files.filter(file => file.startsWith('static/'));
  // A full scan also avoids exceeding the operating system's argument limit.
  return Buffer.byteLength(sources.join('\0')) > 32_000 ? undefined : sources;
}

function ignoreFiles(root: string, revision?: string): string[] {
  return [
    ...new Set(
      git(
        root,
        revision
          ? ['ls-tree', '-r', '--name-only', '-z', revision]
          : ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
      )
        .split('\0')
        .filter(file =>
          /^(?:static\/.*\/|static\/)?\.(?:git|eslint|oxlint)ignore$/.test(file)
        )
    ),
  ].filter(file => revision || existsSync(path.join(root, file)));
}

function baselineCachePath(
  root: string,
  base: string,
  config: unknown,
  plugins: string[]
): string | undefined {
  if (process.env.GITHUB_ACTIONS === 'true') {
    return undefined;
  }
  try {
    const canonicalRoot = realpathSync(root);
    const tree = path.join(canonicalRoot, 'static', 'oxlint');
    if (plugins.some(plugin => !realpathSync(plugin).startsWith(`${tree}${path.sep}`))) {
      return undefined;
    }
    const require = createRequire(path.join(root, 'package.json'));
    const oxlintVersion = require('oxlint/package.json').version;
    assert(typeof oxlintVersion === 'string', 'Missing oxlint version');
    const hash = createHash('sha256');
    hash.update(
      JSON.stringify([
        base,
        config,
        oxlintVersion,
        ts.version,
        process.version,
        process.platform,
        process.arch,
      ])
    );
    hash.update(readFileSync(new URL(import.meta.url)));
    hash.update(readFileSync(path.join(root, 'node_modules/.pnpm/lock.yaml')));
    const files = [
      ...ignoreFiles(root),
      '.node-version',
      'oxlint.config.ts',
      'oxlint.config.incubator.ts',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.json',
    ];
    const collect = (directory: string) => {
      assert(!lstatSync(directory).isSymbolicLink(), 'Symlinked plugin tree');
      for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        assert(!entry.isSymbolicLink(), 'Symlinked plugin source');
        if (entry.isDirectory()) {
          collect(file);
        } else {
          assert(entry.isFile(), 'Non-file plugin source');
          files.push(path.relative(canonicalRoot, file));
        }
      }
    };
    if (existsSync(tree)) {
      assert(realpathSync(tree) === tree, 'Symlinked plugin tree');
      collect(tree);
    }
    for (const file of files.sort()) {
      const absolute = path.join(root, file);
      hash.update(
        JSON.stringify([
          file,
          existsSync(absolute) ? readFileSync(absolute).toString('base64') : null,
        ])
      );
    }
    return path.join(
      root,
      '.artifacts/lint-incubator/baselines',
      `${hash.digest('hex')}.json`
    );
  } catch {
    return undefined;
  }
}

function readBaselineCache(file: string | undefined, base: string, rules: string[]) {
  if (!file) {
    return;
  }
  try {
    const cached = inventorySchema
      .extend({key: z.string()})
      .parse(JSON.parse(readFileSync(file, 'utf8')));
    assert(cached.key === path.basename(file, '.json') && cached.revision === base);
    assert(JSON.stringify(cached.rules) === JSON.stringify(rules));
    assert(cached.occurrences.every(occurrence => rules.includes(occurrence.rule)));
    return cached.occurrences;
  } catch {
    return;
  }
}

function writeBaselineCache(file: string | undefined, inventory: Inventory) {
  if (!file) {
    return;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(
      temporary,
      JSON.stringify({...inventory, key: path.basename(file, '.json')}),
      {flag: 'wx'}
    );
    renameSync(temporary, file);
  } catch {
    // The cache is optional; a successful scan remains authoritative.
  } finally {
    try {
      rmSync(temporary, {force: true});
    } catch {
      // An unwritable cache must not make lint fail.
    }
  }
}

function ruleName(code: string) {
  const match = /^([^()]+)\(([^()]+)\)$/.exec(code);
  assert(match, `Unexpected oxlint diagnostic code ${code}`);
  return `${match[1]}/${match[2]}`;
}

function scan(
  root: string,
  configPath: string,
  binary: string,
  rules: string[],
  files?: string[]
): Occurrence[] {
  const paths = files?.filter(file => existsSync(path.join(root, file))) ?? ['static'];
  if (rules.length === 0 || paths.length === 0) {
    return [];
  }
  const result = spawnSync(
    binary,
    [
      '--config',
      configPath,
      '--disable-nested-config',
      '--format',
      'json',
      '--no-error-on-unmatched-pattern',
      ...paths,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    }
  );
  assert(
    !result.error && (result.status === 0 || result.status === 1),
    `Oxlint failed: ${result.error?.message ?? result.stderr}`
  );
  let output: {diagnostics: Array<z.infer<typeof diagnosticSchema>>};
  try {
    output = z
      .object({
        diagnostics: z.array(diagnosticSchema),
        number_of_files: z.number().int().nonnegative(),
        number_of_rules: z.number().int().positive(),
      })
      .parse(JSON.parse(result.stdout));
  } catch (error) {
    throw new Error(
      `Invalid oxlint output (including parse/configuration errors): ${result.stdout.slice(0, 2000)} ${result.stderr}`,
      {cause: error}
    );
  }
  assert(
    result.status === 0 || output.diagnostics.length > 0,
    'Oxlint failed without diagnostics'
  );
  const sources = new Map<string, {bytes: Uint8Array; source: ts.SourceFile}>();
  return output.diagnostics
    .map(diagnostic => {
      const rule = ruleName(diagnostic.code);
      assert(rules.includes(rule), `Unenrolled rule or parser error: ${diagnostic.code}`);
      const file = path.relative(root, path.resolve(root, diagnostic.filename));
      assert(
        file && !file.startsWith('../') && !path.isAbsolute(file),
        `Diagnostic outside source tree: ${diagnostic.filename}`
      );
      let parsed = sources.get(file);
      if (!parsed) {
        const bytes = readFileSync(path.join(root, file));
        const text = bytes.toString('utf8');
        assert(Buffer.from(text).equals(bytes), `Invalid UTF-8 in ${file}`);
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        parsed = {bytes, source};
        sources.set(file, parsed);
      }
      const {source} = parsed;
      const bytes = Buffer.from(parsed.bytes);
      const spans = diagnostic.labels.map(label => {
        const {offset, length} = label.span;
        assert(offset + length <= bytes.length, `Invalid diagnostic span in ${file}`);
        const before = bytes.subarray(0, offset).toString('utf8');
        const text = bytes.subarray(offset, offset + length).toString('utf8');
        assert(
          Buffer.from(before).equals(bytes.subarray(0, offset)) &&
            Buffer.from(text).equals(bytes.subarray(offset, offset + length)),
          `Invalid UTF-8 diagnostic boundary in ${file}`
        );
        return {start: before.length, end: before.length + text.length, offset, length};
      });
      const start = Math.min(...spans.map(span => span.start));
      const end = Math.max(...spans.map(span => span.end));
      let statement: ts.Node = source;
      function visit(node: ts.Node) {
        if (node.getStart(source) > start || node.end < end) {
          return;
        }
        if (ts.isStatement(node)) {
          statement = node;
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      const statementStart = statement === source ? 0 : statement.getStart(source);
      const statementByteStart = Buffer.byteLength(source.text.slice(0, statementStart));
      // ponytail: exact statement source rejects internal formatting changes; normalize only with a syntax-safe representation.
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            rule,
            diagnostic.message,
            source.text.slice(statementStart, statement.end),
            spans.map(span => [span.offset - statementByteStart, span.length]),
          ])
        )
        .digest('hex');
      const {line, character} = source.getLineAndCharacterOfPosition(spans[0]!.start);
      return {
        rule,
        file,
        line: line + 1,
        column: character + 1,
        message: diagnostic.message,
        help: diagnostic.help ?? null,
        url: diagnostic.url ?? null,
        fingerprint,
      };
    })
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column ||
        a.rule.localeCompare(b.rule)
    );
}

function introducedOccurrences(base: Occurrence[], current: Occurrence[]) {
  const remaining = new Map<string, Map<string, number>>();
  for (const occurrence of base) {
    let paths = remaining.get(occurrence.fingerprint);
    if (!paths) {
      paths = new Map();
      remaining.set(occurrence.fingerprint, paths);
    }
    paths.set(occurrence.file, (paths.get(occurrence.file) ?? 0) + 1);
  }
  const unmatched = current.filter(occurrence => {
    const paths = remaining.get(occurrence.fingerprint);
    const count = paths?.get(occurrence.file) ?? 0;
    if (!count) {
      return true;
    }
    paths!.set(occurrence.file, count - 1);
    return false;
  });
  return unmatched.filter(occurrence => {
    const paths = remaining.get(occurrence.fingerprint);
    for (const [file, count] of paths ?? []) {
      if (count > 0) {
        paths!.set(file, count - 1);
        return false;
      }
    }
    return true;
  });
}

function escapeCommand(value: string) {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

async function main() {
  const {values, positionals, tokens} = parseArgs({
    tokens: true,
    allowPositionals: true,
    options: {
      base: {type: 'string'},
      changed: {type: 'boolean'},
      json: {type: 'boolean'},
      rule: {type: 'string'},
      file: {type: 'string'},
      help: {type: 'boolean'},
    },
  });
  const optionNames = tokens
    .filter(token => token.kind === 'option')
    .map(token => token.name);
  assert(
    new Set(optionNames).size === optionNames.length,
    'Options may only be supplied once'
  );
  if (values.help) {
    console.log(
      'Usage: lint-incubator.ts check [--base REF] [--changed] [--json]\n       lint-incubator.ts backlog [--rule RULE] [--file PATH] [--json]\n       lint-incubator.ts snapshot\ncheck defaults to the merge base of HEAD and local origin/master. --base compares that exact revision. --changed checks changed files, falling back to a full scan for lint policy changes. Exit codes: 0 clean, 1 introduced findings, 2 invalid input or scan failure.'
    );
    return;
  }
  const command = positionals[0];
  assert(
    positionals.length === 1 && ['check', 'backlog', 'snapshot'].includes(command!),
    'Expected check, backlog, or snapshot. Use --help.'
  );
  assert(
    command === 'check' || values.base === undefined,
    '--base is only valid for check'
  );
  assert(command === 'check' || !values.changed, '--changed is only valid for check');
  assert(
    command === 'backlog' || (values.rule === undefined && values.file === undefined),
    '--rule and --file are only valid for backlog'
  );
  assert(
    Object.values(values).every(value => value !== ''),
    'Options must not be empty'
  );
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const revision = resolveRevision(root, 'HEAD');
  const base =
    command === 'check'
      ? values.base
        ? resolveRevision(root, values.base)
        : defaultBase(root, revision)
      : undefined;
  const files = values.changed ? changedFiles(root, base!) : undefined;
  const profile = (
    await import(pathToFileURL(path.join(root, 'oxlint.config.incubator.ts')).href)
  ).default;
  const rules = Object.keys(
    z
      .record(
        z.string(),
        z.union([z.literal('error'), z.tuple([z.literal('error')]).rest(z.unknown())])
      )
      .parse(profile.rules)
  ).sort();
  assert(
    !values.rule || rules.includes(values.rule),
    `Rule is not enrolled: ${values.rule}`
  );
  const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'lint-incubator-')));
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const configPath = path.join(root, 'oxlint.config.incubator.ts');
    const binary = path.join(root, 'node_modules', '.bin', 'oxlint');
    const config = {
      ...profile,
      jsPlugins: profile.jsPlugins?.map(
        (plugin: string | {name: string; specifier: string}) =>
          typeof plugin === 'string'
            ? require.resolve(plugin)
            : {...plugin, specifier: require.resolve(plugin.specifier)}
      ),
    };
    const inventory: Inventory = {
      schemaVersion: 1,
      revision,
      rules,
      occurrences: scan(root, configPath, binary, rules, files),
    };
    let introduced: Occurrence[] = [];
    if (base && rules.length > 0 && files?.length !== 0) {
      const cachePath = baselineCachePath(
        root,
        base,
        config,
        config.jsPlugins?.map((plugin: string | {specifier: string}) =>
          typeof plugin === 'string' ? plugin : plugin.specifier
        ) ?? []
      );
      let baseline = readBaselineCache(cachePath, base, rules);
      if (!baseline) {
        const archive = path.join(scratch, 'base.tar');
        execFileSync('git', [
          '-C',
          root,
          'archive',
          '--format=tar',
          `--output=${archive}`,
          base,
          '--',
          ...git(root, [
            'ls-tree',
            '--name-only',
            base,
            '--',
            'static',
            '.gitignore',
            '.eslintignore',
          ])
            .split('\n')
            .filter(Boolean),
        ]);
        const baseRoot = mkdtempSync(path.join(scratch, 'base-'));
        execFileSync('tar', ['-xf', archive, '-C', baseRoot]);
        for (const file of ignoreFiles(root, base)) {
          rmSync(path.join(baseRoot, file), {force: true});
        }
        for (const file of ignoreFiles(root)) {
          const destination = path.join(baseRoot, file);
          mkdirSync(path.dirname(destination), {recursive: true});
          copyFileSync(path.join(root, file), destination);
        }
        symlinkSync(
          path.join(root, 'node_modules'),
          path.join(baseRoot, 'node_modules'),
          'dir'
        );
        const baseConfigPath = path.join(baseRoot, 'oxlint.config.incubator.json');
        writeFileSync(baseConfigPath, JSON.stringify(config));
        baseline = scan(baseRoot, baseConfigPath, binary, rules);
        writeBaselineCache(cachePath, {
          schemaVersion: 1,
          revision: base,
          rules,
          occurrences: baseline,
        });
      }
      const selected = files ? new Set(files) : undefined;
      introduced = introducedOccurrences(
        selected
          ? baseline.filter(occurrence => selected.has(occurrence.file))
          : baseline,
        inventory.occurrences
      );
    }
    if (command === 'backlog') {
      inventory.occurrences = inventory.occurrences.filter(
        item =>
          (!values.rule || item.rule === values.rule) &&
          (!values.file || item.file === values.file)
      );
    }
    const result = base
      ? {
          ...inventory,
          base,
          introduced,
          ...(values.changed ? {scope: files ? 'changed' : 'full'} : {}),
        }
      : inventory;
    if (command === 'snapshot' || command === 'backlog' || values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        rules.length
          ? `${introduced.length} introduced finding(s); ${inventory.occurrences.length} ${files ? 'in changed files' : 'total'}. Base ${base}.`
          : `No incubator rules enrolled. Base ${base}.`
      );
      for (const occurrence of introduced) {
        console.log(
          `${occurrence.file}:${occurrence.line}:${occurrence.column} ${occurrence.rule}: ${occurrence.message}`
        );
      }
    }
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const occurrence of introduced) {
        console.error(
          `::error file=${escapeCommand(occurrence.file)},line=${occurrence.line},col=${occurrence.column},title=${escapeCommand(occurrence.rule)}::${escapeCommand(occurrence.message)}`
        );
      }
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `### Lint incubator\n\n${rules.length ? `${rules.length} enrolled rule(s), ${inventory.occurrences.length} finding(s) ${files ? 'in changed files' : 'total'}, ${introduced.length} introduced.` : 'No rules enrolled. No lint scans performed.'}\n\nRevision: \`${revision}\`${base ? `\n\nBase: \`${base}\`` : ''}\n`
        );
      }
    }
    process.exitCode = introduced.length ? 1 : 0;
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error(
    `Lint incubator: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 2;
});
