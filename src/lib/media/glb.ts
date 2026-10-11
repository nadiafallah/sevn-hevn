/**
 * Checks that a file is a self-contained glTF 2.0 binary (.glb) the website can show: the right
 * signature and version, consistent chunk lengths, readable JSON, at least one mesh, every buffer
 * and texture inside the file, and no compression that would need a decoder from another site.
 * Returns what the panel needs to offer: animation and colourway (variant) names.
 */

export const MAX_MODEL_BYTES = 25 * 1024 * 1024;

export type GlbProblem = "model_type" | "model_version" | "model_corrupt" | "model_external" | "model_compressed" | "model_empty" | "model_too_large";

export class GlbError extends Error {
  constructor(readonly code: GlbProblem) {
    super(code);
  }
}

export interface GlbInfo {
  bytes: number;
  meshes: number;
  animations: string[];
  variants: string[];
  extensions: string[];
}

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"
/** These need a decoder downloaded at view time; the site's security policy allows none. */
const NEEDS_DECODER = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression", "KHR_texture_basisu"];

interface GltfJson {
  asset?: { version?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  buffers?: { uri?: string; byteLength?: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: { uri?: string }[];
  meshes?: unknown[];
  animations?: { name?: string }[];
  extensions?: { KHR_materials_variants?: { variants?: { name?: string }[] } };
}

export function inspectGlb(file: Uint8Array): GlbInfo {
  if (file.byteLength > MAX_MODEL_BYTES) throw new GlbError("model_too_large");
  if (file.byteLength < 20) throw new GlbError("model_type");
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new GlbError("model_type");
  if (dv.getUint32(4, true) !== 2) throw new GlbError("model_version");
  const length = dv.getUint32(8, true);
  if (length !== file.byteLength) throw new GlbError("model_corrupt");

  const jsonLength = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== JSON_CHUNK || 20 + jsonLength > length) throw new GlbError("model_corrupt");
  let json: GltfJson;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.subarray(20, 20 + jsonLength)));
  } catch {
    throw new GlbError("model_corrupt");
  }
  if (!json || typeof json !== "object" || json.asset?.version !== "2.0") throw new GlbError("model_version");

  let binLength = 0;
  const binStart = 20 + jsonLength;
  if (binStart < length) {
    if (binStart + 8 > length) throw new GlbError("model_corrupt");
    binLength = dv.getUint32(binStart, true);
    if (dv.getUint32(binStart + 4, true) !== BIN_CHUNK || binStart + 8 + binLength > length) throw new GlbError("model_corrupt");
  }

  // Everything must be inside the file: a model that points at other files would not load.
  const external = (uri?: string) => uri !== undefined && !uri.startsWith("data:");
  if ((json.buffers ?? []).some((b) => external(b.uri)) || (json.images ?? []).some((i) => external(i.uri))) throw new GlbError("model_external");
  for (const view of json.bufferViews ?? []) {
    const buffer = json.buffers?.[view.buffer];
    if (!buffer || (buffer.uri === undefined && (view.byteOffset ?? 0) + view.byteLength > binLength)) throw new GlbError("model_corrupt");
  }

  const extensions = [...new Set([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])])];
  if (extensions.some((e) => NEEDS_DECODER.includes(e))) throw new GlbError("model_compressed");
  const meshes = Array.isArray(json.meshes) ? json.meshes.length : 0;
  if (!meshes) throw new GlbError("model_empty");

  return {
    bytes: file.byteLength,
    meshes,
    animations: (json.animations ?? []).map((a, i) => (typeof a.name === "string" && a.name.trim() ? a.name.trim().slice(0, 100) : `animation_${i}`)),
    variants: (json.extensions?.KHR_materials_variants?.variants ?? []).map((v, i) => (typeof v.name === "string" ? v.name.slice(0, 100) : `variant_${i}`)),
    extensions,
  };
}

/** Natural order for file names, so IMG_2, IMG_10 sort as a camera numbered them. */
export function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
