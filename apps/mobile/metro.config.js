// Metro needs telling about the monorepo: by default it only watches this
// package, so edits to packages/shared would not trigger a rebuild and its
// hoisted dependencies would not resolve.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Without this, a package hoisted to the root can be resolved twice and React
// ends up duplicated — which fails at runtime with confusing hook errors.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
