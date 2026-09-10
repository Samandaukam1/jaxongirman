import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { Platform } from "react-native";

// Bundled with the app: the character never comes off the network.
import source from "../../../assets/mascot/jaxongirman.glb";

let cached: Promise<ArrayBuffer> | null = null;

/** The rigged character, as bytes GLTFLoader can parse on either platform. */
export function loadMascotModel(): Promise<ArrayBuffer> {
  if (!cached) cached = read();
  return cached;
}

async function read(): Promise<ArrayBuffer> {
  const asset = Asset.fromModule(source);
  if (!asset.downloaded) await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`mascot ${response.status}`);
    return response.arrayBuffer();
  }
  return new File(uri).arrayBuffer();
}
