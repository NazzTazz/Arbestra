// Converts the « carré potager » garden kit (GLB + manifest placement rules)
// into the game's AB01 asset format, once, so the client needs no glTF loader.
// Usage: node scripts/convert-garden-kit.mjs
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { TextDecoder, TextEncoder } from 'node:util';
import { URL } from 'node:url';
import console from 'node:console';

const kitDir = new URL('../blender-elements/carre-potager/', import.meta.url);
const outDir = new URL('../apps/world-web/public/garden/', import.meta.url);
const manifestUrl = new URL('../apps/world-web/src/scene/garden-kit-manifest.json', import.meta.url);

function readGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binStart = 20 + jsonLength + 8;
  return { json, bin: bytes.subarray(binStart, binStart + view.getUint32(20 + jsonLength, true)) };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor({ json, bin }, index) {
  const a = json.accessors[index],
    view = json.bufferViews[a.bufferView],
    size = COMPONENTS[a.type],
    stride = view.byteStride ?? 0,
    base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0),
    data = new DataView(bin.buffer, bin.byteOffset + base),
    bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType],
    out = new Array(a.count * size);
  for (let i = 0; i < a.count; i++)
    for (let c = 0; c < size; c++) {
      const offset = i * (stride || size * bytes) + c * bytes;
      let v =
        a.componentType === 5126
          ? data.getFloat32(offset, true)
          : a.componentType === 5125
            ? data.getUint32(offset, true)
            : a.componentType === 5123
              ? data.getUint16(offset, true)
              : data.getUint8(offset);
      if (a.normalized) v /= a.componentType === 5123 ? 65535 : 255;
      out[i * size + c] = v;
    }
  return out;
}

/** AB01, as decoded by building-asset-format.ts: JSON, then aligned Float32/Uint32 buffers. */
function encode(scene) {
  const arrays = [];
  let offset = 0;
  for (const geometry of scene.geometries.vertexData)
    for (const key of ['positions', 'normals', 'uvs', 'colors', 'indices']) {
      if (!geometry[key]) continue;
      const integer = key === 'indices',
        array = integer ? new Uint32Array(geometry[key]) : new Float32Array(geometry[key]);
      geometry[key] = { offset, length: array.length, integer };
      arrays.push(array);
      offset += array.byteLength;
    }
  const json = new TextEncoder().encode(JSON.stringify(scene)),
    start = 8 + Math.ceil(json.length / 4) * 4,
    bytes = new Uint8Array(start + offset),
    header = new DataView(bytes.buffer);
  header.setUint32(0, 0x41423031);
  header.setUint32(4, json.length, true);
  bytes.set(json, 8);
  let cursor = start;
  for (const array of arrays) {
    bytes.set(new Uint8Array(array.buffer), cursor);
    cursor += array.byteLength;
  }
  return bytes;
}

const glb = readGlb(new Uint8Array(await readFile(new URL('assets/carre-potager.glb', kitDir))));
const kitManifest = JSON.parse(await readFile(new URL('manifest.json', kitDir), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

await mkdir(outDir, { recursive: true });
for (const name of await readdir(outDir)) if (name.startsWith('garden-')) await unlink(new URL(name, outDir));

// Embedded textures, written as their own cacheable PNG files.
const textures = {};
for (const material of glb.json.materials) {
  const index = material.pbrMetallicRoughness?.baseColorTexture?.index;
  if (index === undefined) continue;
  const image = glb.json.images[glb.json.textures[index].source],
    view = glb.json.bufferViews[image.bufferView],
    png = glb.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength),
    file = `garden-${material.name.replace(/^OPUS_/, '')}-${hash(png)}.png`;
  await writeFile(new URL(file, outDir), png);
  textures[material.name] = file;
}

// glTF is right-handed with +Z towards the viewer; the scene is left-handed:
// negate Z. The index order then already matches the scene's front faces
// (checked against Babylon's own normal computation in garden-kit.test.ts).
const pieces = [],
  vertexData = [];
for (const node of glb.json.nodes) {
  if (node.mesh === undefined) continue;
  glb.json.meshes[node.mesh].primitives.forEach((primitive, index) => {
    const positions = accessor(glb, primitive.attributes.POSITION),
      normals = primitive.attributes.NORMAL === undefined ? null : accessor(glb, primitive.attributes.NORMAL),
      indices = accessor(glb, primitive.indices);
    for (let i = 2; i < positions.length; i += 3) positions[i] = -positions[i];
    if (normals) for (let i = 2; i < normals.length; i += 3) normals[i] = -normals[i];
    const id = `${node.name}#${index}`;
    vertexData.push({
      id,
      positions,
      ...(normals ? { normals } : {}),
      ...(primitive.attributes.TEXCOORD_0 === undefined ? {} : { uvs: accessor(glb, primitive.attributes.TEXCOORD_0) }),
      ...(primitive.attributes.COLOR_0 === undefined ? {} : { colors: accessor(glb, primitive.attributes.COLOR_0) }),
      indices,
    });
    pieces.push({ source: node.name, geometry: id, material: glb.json.materials[primitive.material].name });
  });
}

// Placement rules, Blender (x, y ground, z up) → scene (x, z up, y) from a
// plot's corner; Blender Z rotations become negated Y rotations.
const pose = kitManifest.pose;
const placement = {
  rows: pose.rangs_y,
  columns: pose.touffes_x,
  height: pose.touffes_z,
  growth: pose.croissance.sort((a, b) => a.stade - b.stade).map((g) => ({ piece: g.piece, scale: g.echelle })),
  crate: {
    stage: pose.cagette.stade,
    position: [pose.cagette.position[0], pose.cagette.position[2], pose.cagette.position[1]],
    rotationY: -pose.cagette.rotation_z,
  },
};

const asset = gzipSync(encode({ cellSize: kitManifest.cellule, pieces, placement, geometries: { vertexData } }), {
  level: 9,
});
const file = `garden-kit-${hash(asset)}.abmesh.gz`;
await writeFile(new URL(file, outDir), asset);
await writeFile(
  manifestUrl,
  JSON.stringify(
    {
      kit: `/garden/${file}`,
      textures: Object.fromEntries(Object.entries(textures).map(([k, v]) => [k, `/garden/${v}`])),
    },
    null,
    2,
  ) + '\n',
);
console.log(`${pieces.length} pieces, ${(asset.length / 1024).toFixed(0)} KiB → ${file}`);
