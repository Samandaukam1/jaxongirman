const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

/**
 * SVG files compile to react-native-svg components at bundle time.
 *
 * Needed for `assets/icons/*.svg`, which is how those icons are asked to be
 * used. It also takes `svg` out of `assetExts`, so a `.svg` can no longer be
 * required as an image URI anywhere in this app — there is one way to use one,
 * and this is it.
 */
config.transformer.babelTransformerPath = require.resolve("react-native-svg-transformer/expo");
config.resolver.assetExts = config.resolver.assetExts.filter((extension) => extension !== "svg");
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
