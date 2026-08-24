const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

/**
 * SVG files are compiled to react-native-svg components at bundle time.
 *
 * The alternative was to hand-translate `assets/soft-ai/*.svg` into React
 * components, which works right up until somebody edits the SVG and the
 * component does not change with it. This way the file on disk is the artwork,
 * and there is no second copy of it to keep in step.
 */
config.transformer.babelTransformerPath = require.resolve("react-native-svg-transformer/expo");
config.resolver.assetExts = config.resolver.assetExts.filter((extension) => extension !== "svg");
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
