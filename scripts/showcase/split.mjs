// Keeps only the named nodes of a .glb (e.g. one of two suitcases in a scene) and centres it.
// Needs: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4
// Usage: node split.mjs in.glb out.glb '<node-name regex>'
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, center } from "@gltf-transform/functions";
const [src, out, keepRe] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const keep = new RegExp(keepRe);
for (const node of doc.getRoot().listNodes()) if (!keep.test(node.getName())) node.dispose();
await doc.transform(prune(), center({ pivot: "below" }));
await io.write(out, doc);
console.log(out, doc.getRoot().listNodes().map((n) => n.getName()).join(", "));
