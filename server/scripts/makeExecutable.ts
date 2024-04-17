import { compile } from 'nexe';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const NODE_VERSION = '20.11.1';
const OSX_TARGET = `mac-x64-${NODE_VERSION}`;
const LINUX_TARGET = `linux-x64-${NODE_VERSION}`;
const WINDOWS_TARGET = `windows-x64-${NODE_VERSION}`;
const ALL_TARGETS = [OSX_TARGET, LINUX_TARGET, WINDOWS_TARGET] as const;

const args = await yargs(hideBin(process.argv))
  .scriptName('tunarr-make-exec')
  .option('target', {
    alias: 't',
    array: true,
    type: 'string',
    choices: ALL_TARGETS,
    default: ALL_TARGETS,
  })
  .demandOption('target')
  .option('build', {
    type: 'boolean',
    default: true,
  })
  .option('python', {
    type: 'string',
    default: 'python3',
  })
  .option('tempdir', {
    type: 'string',
  })
  .parseAsync();

for (const target of args.target) {
  let binaryName: string;
  switch (target) {
    case 'mac-x64-20.11.1':
      binaryName = 'tunarr-macos-x64';
      break;
    case 'linux-x64-20.11.1':
      binaryName = 'tunarr-linux-x64';
      break;
    case 'windows-x64-20.11.1':
      binaryName = 'tunarr-windows-x64.exe';
      break;
  }

  await compile({
    input: 'bundle.js',
    name: binaryName,
    cwd: './build',
    targets: [target],
    build: true,
    bundle: false,
    resources: [
      './migrations/**/*',
      './build/better_sqlite3.node',
      './resources/**/*',
    ],
    python: args.python,
    temp: args.tempdir,
    verbose: target === 'windows-x64-20.11.1',
    remote:
      'https://github.com/chrisbenincasa/tunarr/releases/download/nexe-prebuild',
  });
}
