import path from 'path';

const pkg = require(path.resolve(__dirname, '../../package.json'));

export const LLMWithMCPLib = {
  name: pkg.name,
  version: pkg.version,
  symbol: `$$${pkg.name}`
}
