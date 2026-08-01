const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageDirectory = process.cwd();
const testDirectory = path.join(packageDirectory, '__tests__');
const jestBin = require.resolve('jest/bin/jest');
const forwardedArguments = process.argv.slice(2);
const requestedTestPath = forwardedArguments.some((argument) => !argument.startsWith('-'));

const nodeOptions = [process.env.NODE_OPTIONS, '--experimental-vm-modules']
  .filter(Boolean)
  .join(' ');
const environment = { ...process.env, NODE_OPTIONS: nodeOptions };

const runJest = (arguments) => {
  const result = spawnSync(process.execPath, [jestBin, ...arguments], {
    cwd: packageDirectory,
    env: environment,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
};

if (requestedTestPath) {
  process.exit(runJest(['--runInBand', '--openHandlesTimeout=0', ...forwardedArguments]));
}

const findTestFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findTestFiles(entryPath);
    }
    return /\.test\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
  });

// pdfjs-dist is a native ESM dependency. Jest tears down the module realm after
// each test file, while Node keeps native ESM modules cached process-wide. Run
// each file in a fresh process so every suite exercises the real Node converter
// without inheriting an already-destroyed PDF.js realm.
const testFiles = findTestFiles(testDirectory).sort();

for (const testFile of testFiles) {
  const status = runJest([
    '--runInBand',
    '--openHandlesTimeout=0',
    '--runTestsByPath',
    testFile,
    ...forwardedArguments,
  ]);
  if (status !== 0) {
    process.exit(status);
  }
}
