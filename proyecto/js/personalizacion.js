"use strict";

const vehicleStatus = document.querySelector("#vehicle-status");
const vehicle = document.querySelector("#vehicle");
const vehicleImage = document.querySelector("#vehicle-image");
const imageStatus = document.querySelector("#vehicle-image-status");
const viewer = document.querySelector("#car-viewer");
const paintSelector = document.querySelector("#paint-selector");
const finishSelector = document.querySelector("#finish-selector");
const rimSelector = document.querySelector("#rim-selector");
const rimDesignSelector = document.querySelector("#rim-design-selector");
const rimStatus = document.querySelector("#rim-status");
const paintStatus = document.querySelector("#paint-status");
const tireSelector = document.querySelector("#tire-selector");
const tireStatus = document.querySelector("#tire-status");
const caliperSelector = document.querySelector("#caliper-selector");
const discSelector = document.querySelector("#disc-selector");
const brakeStatus = document.querySelector("#brake-status");

function createDiscShape(THREE, innerRadius, drilled, slotted) {
  const shape = new THREE.Shape();
  // Contorno exterior fino y hueco central, normalizados al radio del disco.
  for (let i = 0; i <= 96; i++) {
    const angle = i * Math.PI * 2 / 96;
    if (i === 0) shape.moveTo(Math.cos(angle), Math.sin(angle));
    else shape.lineTo(Math.cos(angle), Math.sin(angle));
  }
  const center = new THREE.Path();
  center.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(center);
  if (drilled) {
    for (const radius of [0.62, 0.82]) {
      for (let i = 0; i < 18; i++) {
        const angle = i * Math.PI * 2 / 18;
        const hole = new THREE.Path();
        hole.absarc(Math.cos(angle) * radius, Math.sin(angle) * radius,
          0.024, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
    }
  }
  if (slotted) {
    for (let i = 0; i < 9; i++) {
      // Las ranuras quedan entre filas de agujeros, sin cruzarlos.
      const angle = i * Math.PI * 2 / 9 + Math.PI / 18;
      const start = new THREE.Vector2(Math.cos(angle) * 0.54, Math.sin(angle) * 0.54);
      const end = new THREE.Vector2(Math.cos(angle + 0.07) * 0.92, Math.sin(angle + 0.07) * 0.92);
      const normal = new THREE.Vector2(-(end.y - start.y), end.x - start.x).normalize().multiplyScalar(0.012);
      const slot = new THREE.Path();
      slot.moveTo(start.x + normal.x, start.y + normal.y);
      slot.lineTo(end.x + normal.x, end.y + normal.y);
      slot.lineTo(end.x - normal.x, end.y - normal.y);
      slot.lineTo(start.x - normal.x, start.y - normal.y);
      slot.closePath();
      shape.holes.push(slot);
    }
  }
  return shape;
}

function createDiscAlternatives(THREE, discs, materials) {
  const styles = new Map([["original", [...discs.keys()]]]);
  const dimensions = [];
  for (const original of discs.keys()) {
    const positions = original.geometry.attributes.position;
    if (!positions || positions.itemSize !== 3) return { styles, valid: false };
    original.geometry.computeBoundingBox();
    const bounds = original.geometry.boundingBox;
    const center = bounds.getCenter(new THREE.Vector3());
    let innerRadius = Infinity;
    let radius = 0;
    for (let i = 0; i < positions.count; i++) {
      const radial = Math.hypot(positions.getY(i) - center.y, positions.getZ(i) - center.z);
      innerRadius = Math.min(innerRadius, radial);
      radius = Math.max(radius, radial);
    }
    const thickness = bounds.max.x - bounds.min.x;
    // Solo sustituye los anillos comprobados; no presupone geometría de otro GLB.
    if (![innerRadius, radius, thickness].every((value) => Number.isFinite(value) && value > 0) ||
        Math.abs(innerRadius / radius - 0.46) > 0.02 || thickness / radius > 0.2) {
      return { styles, valid: false };
    }
    dimensions.push({ original, center, radius, innerRadius, thickness });
  }
  const surface = new THREE.MeshStandardMaterial({ color: "#b9bec5", metalness: 0.65, roughness: 0.38 });
  const recess = new THREE.MeshStandardMaterial({ color: "#656b73", metalness: 0.65, roughness: 0.48 });
  materials.add(surface);
  materials.add(recess);
  const ratio = dimensions[0].innerRadius / dimensions[0].radius;
  const extrude = (shape, depth, offset) => {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8, steps: 1 });
    geometry.translate(0, 0, offset);
    // La extrusión Z se alinea con el eje X local de los BrakeDisc originales.
    geometry.rotateY(Math.PI / 2);
    return geometry;
  };
  for (const finish of ["drilled", "slotted", "drilled-slotted"]) {
    const drilled = finish !== "slotted";
    const slotted = finish !== "drilled";
    const baseShape = createDiscShape(THREE, ratio, drilled, false);
    // Núcleo con agujeros pasantes y dos caras recortadas: las ranuras tienen fondo.
    const layers = slotted
      ? [
          { geometry: extrude(baseShape, 0.80, -0.40), material: recess },
          { geometry: extrude(createDiscShape(THREE, ratio, drilled, true), 0.10, -0.50), material: surface },
          { geometry: extrude(createDiscShape(THREE, ratio, drilled, true), 0.10, 0.40), material: surface }
        ]
      : [{ geometry: extrude(baseShape, 1, -0.50), material: surface }];
    const replacements = [];
    for (const { original, center, radius, thickness } of dimensions) {
      const replacement = new THREE.Group();
      replacement.name = `${original.name}_${finish}`;
      replacement.position.copy(original.position);
      replacement.quaternion.copy(original.quaternion);
      replacement.scale.copy(original.scale);
      const fitted = new THREE.Group();
      fitted.position.copy(center);
      fitted.scale.set(thickness, radius, radius);
      replacement.add(fitted);
      for (const { geometry, material } of layers) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = original.castShadow;
        mesh.receiveShadow = original.receiveShadow;
        fitted.add(mesh);
      }
      replacement.visible = false;
      original.parent.add(replacement);
      replacements.push(replacement);
    }
    // Cada capa comparte geometría y material entre las cuatro ruedas.
    styles.set(finish, replacements);
  }
  return { styles, valid: true };
}

function activateDiscFinish(styles, id) {
  if (!styles?.has(id)) return false;
  // Oculta solo BrakeDisc: no deja el disco original tapando los agujeros.
  for (const [finish, meshes] of styles) {
    for (const mesh of meshes) mesh.visible = finish === id;
  }
  return true;
}

function prepareBrakeStyles(THREE, gltf) {
  const nodes = [
    [82, 76, "WheelFrontLBrakePad", 16], [87, 78, "WheelFrontRBrakePad", 16],
    [92, 81, "WheelRearLBrakePad", 16], [97, 83, "WheelRearRBrakePad", 16],
    [83, 77, "WheelFrontLBrakeDisc", 17], [88, 79, "WheelFrontRBrakeDisc", 17],
    [91, 80, "WheelRearLBrakeDisc", 17], [96, 82, "WheelRearRBrakeDisc", 17]
  ];
  const json = gltf.parser.json;
  if (json.materials[16]?.name !== "Brake" || json.materials[17]?.name !== "Disc" ||
      !nodes.every(([node, mesh, name, material]) => json.nodes[node]?.name === name &&
        json.nodes[node]?.mesh === mesh && json.meshes[mesh]?.primitives.length === 1 &&
        json.meshes[mesh].primitives[0].material === material)) return null;
  const expected = new Map(nodes.map(([, mesh, , material]) => [mesh, material]));
  const targets = new Map();
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const association = gltf.parser.associations.get(object);
    const material = expected.get(association?.meshes);
    if (material !== undefined && association.primitives === 0 &&
        object.material?.name === json.materials[material].name && object.material.color?.isColor) {
      targets.set(association.meshes, object);
    }
  });
  if (targets.size !== 8) return null;
  const calipers = new Map([76, 78, 81, 83].map((mesh) => {
    const object = targets.get(mesh);
    return [object, object.material];
  }));
  const discs = new Map([77, 79, 80, 82].map((mesh) => {
    const object = targets.get(mesh);
    return [object, object.material];
  }));
  const materials = new Set([...calipers.values(), ...discs.values()]);
  const caliperStyles = new Map([["original", calipers]]);
  const colors = { red: "#d92b30", yellow: "#f2cb24", blue: "#246bdb", black: "#17191c", gold: "#c4a45a" };
  for (const [id, color] of Object.entries(colors)) {
    const clones = new Map();
    const assignments = new Map();
    for (const [object, source] of calipers) {
      // Clona incluso si otra pieza comparte material; Original queda intacto.
      if (!clones.has(source)) {
        const material = source.clone();
        material.color.set(color);
        // La emisión del atlas no se tiñe con color: retírala de las variantes.
        material.emissiveMap = null;
        material.emissive.set(0x000000);
        material.map = null;
        // Acabado pintado para distinguir los colores bajo las luces existentes.
        material.metalness = id === "gold" ? 0.55 : 0.15;
        material.roughness = 0.32;
        clones.set(source, material);
        materials.add(material);
      }
      assignments.set(object, clones.get(source));
    }
    caliperStyles.set(id, assignments);
  }
  const alternatives = createDiscAlternatives(THREE, discs, materials);
  return { caliperStyles, discStyles: alternatives.styles, materials, discGeometryValid: alternatives.valid };
}

function applyBrakeStyle(styles, id) {
  const assignments = styles?.get(id);
  if (!assignments) return;
  // Recursos preparados una vez; Original restaura el material exacto del GLB.
  for (const [object, material] of assignments) object.material = material;
}

function createTreadTextures(THREE, style) {
  const size = 256;
  const color = new Uint8Array(size * size * 4);
  const height = new Uint8Array(size * size * 4);
  const periodicDistance = (value) => Math.abs(value - Math.round(value));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // U cruza la banda; V da ocho vueltas de textura en las UV originales.
      const longitudinal = style === "sport"
        ? Math.min(...[0.22, 0.5, 0.78].map((lane) => Math.abs(u - lane))) < 0.018
        : Math.min(Math.abs(u - 0.30), Math.abs(u - 0.70)) < 0.012;
      const transverse = style === "sport"
        ? periodicDistance(v * 6 + Math.abs(u - 0.5) * 2) < 0.07
        : (u < 0.24 || u > 0.76) && periodicDistance(v * 3 + u * 0.5) < 0.045;
      const groove = longitudinal || transverse;
      const offset = (y * size + x) * 4;
      color.set(groove ? [9, 10, 11, 255] : [39, 41, 43, 255], offset);
      const level = groove ? 30 : 220;
      height.set([level, level, level, 255], offset);
    }
  }
  const map = new THREE.DataTexture(color, size, size);
  const bumpMap = new THREE.DataTexture(height, size, size);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, bumpMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  return { map, bumpMap };
}

function createSidewallTexture(THREE, style) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear la textura del flanco");
  const center = canvas.width / 2;
  context.fillStyle = "#17191b";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Las UV de ambos flancos forman el mismo anillo entre radios 0,375 y 0,497.
  const ring = (radius, color, width) => {
    context.beginPath();
    context.arc(center, center, radius * canvas.width, 0, Math.PI * 2);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke();
  };
  ring(0.386, "#27292b", 3);
  ring(0.481, "#27292b", 3);
  if (style === "slick") ring(0.469, "#f2cb24", 10);
  const curvedText = (text, angle, color) => {
    const radius = canvas.width * 0.431;
    context.font = "bold 30px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color;
    const advances = [...text].map((letter) => context.measureText(letter).width + 3);
    let cursor = angle - advances.reduce((sum, width) => sum + width, 0) / radius / 2;
    [...text].forEach((letter, index) => {
      const position = cursor + advances[index] / radius / 2;
      context.save();
      context.translate(center + Math.cos(position) * radius, center + Math.sin(position) * radius);
      context.rotate(position + Math.PI / 2);
      context.fillText(letter, 0, 0);
      context.restore();
      cursor += advances[index] / radius;
    });
  };
  const label = style === "sport" ? "SPORT" : style === "semislick" ? "SEMI SLICK" : "RACING SLICK";
  const lettering = style === "sport" ? "#51555a" : "#f4f5f6";
  curvedText(label, -Math.PI / 2, lettering);
  curvedText(style === "slick" ? "COMPETITION" : "PERFORMANCE", Math.PI / 2, lettering);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Igual que los mapas GLTF: evita reflejar verticalmente las letras.
  texture.flipY = false;
  return texture;
}

function prepareTireStyles(THREE, gltf) {
  // Primitivas verificadas: flanco (0) y rodadura (1), nunca llantas ni frenos.
  const tireNodes = [[84, 89], [89, 91], [94, 93], [99, 95]];
  const json = gltf.parser.json;
  if (json.materials[18]?.name !== "Tireside" || json.materials[19]?.name !== "Tiretread" ||
      !tireNodes.every(([node, mesh]) => json.nodes[node]?.mesh === mesh &&
        json.meshes[mesh]?.primitives.length === 2 &&
        json.meshes[mesh].primitives[0].material === 18 &&
        json.meshes[mesh].primitives[1].material === 19)) return null;
  const indices = new Set(tireNodes.map(([, mesh]) => mesh));
  const targets = new Map();
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const association = gltf.parser.associations.get(object);
    if (indices.has(association?.meshes) && [0, 1].includes(association.primitives) &&
        object.material?.name === (association.primitives === 0 ? "Tireside" : "Tiretread") &&
        object.geometry.attributes.uv?.itemSize === 2) {
      targets.set(`${association.meshes}:${association.primitives}`, object);
    }
  });
  if (targets.size !== 8) return null;
  const originals = new Map([...targets.values()].map((object) => [object, object.material]));
  const textures = new Map(["sport", "semislick"].map((style) => [style, createTreadTextures(THREE, style)]));
  const sidewallTextures = new Map(["sport", "semislick", "slick"]
    .map((style) => [style, createSidewallTexture(THREE, style)]));
  const styles = new Map([["original", originals]]);
  const materials = new Set(originals.values());
  for (const style of ["sport", "semislick", "slick"]) {
    const clones = new Map();
    const assignments = new Map();
    for (const [object, source] of originals) {
      if (!clones.has(source)) {
        // Aísla cada variante; Original conserva su material y mapas exactos.
        const material = source.clone();
        material.normalMap = null;
        const sidewall = source.name === "Tireside";
        material.map = sidewall ? sidewallTextures.get(style) : textures.get(style)?.map ?? null;
        material.bumpMap = sidewall ? null : textures.get(style)?.bumpMap ?? null;
        // Retira también el AO horneado del flanco para no conservar marcas antiguas.
        if (sidewall) material.aoMap = null;
        material.color.set(!sidewall && style === "slick" ? "#27292b" : "#ffffff");
        material.roughness = sidewall ? 0.78 : style === "sport" ? 0.85 : style === "semislick" ? 0.72 : 0.55;
        object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox;
        const radius = Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y),
          Math.abs(bounds.min.z), Math.abs(bounds.max.z));
        // Bump simula surcos con luz, sin desplazar vértices ni cambiar diámetro.
        material.bumpScale = radius * (style === "sport" ? 0.012 : 0.008);
        clones.set(source, material);
        materials.add(material);
      }
      assignments.set(object, clones.get(source));
    }
    styles.set(style, assignments);
  }
  return { styles, materials };
}

function prepareRimMaterials(gltf) {
  // Índices y nombres comprobados en CarConcept.glb, sin coincidencias parciales.
  const rimNodes = [[81, 90, "WheelFrontLRim"], [86, 92, "WheelFrontRRim"],
    [93, 94, "WheelRearLRim"], [98, 96, "WheelRearRRim"]];
  const json = gltf.parser.json;
  const valid = rimNodes.every(([node, mesh, name]) =>
    json.nodes[node]?.name === name && json.nodes[node]?.mesh === mesh &&
    json.meshes[mesh]?.primitives.length === 2 &&
    json.meshes[mesh].primitives.every((primitive, index) => primitive.material === 20 + index)
  ) && json.materials[20]?.name === "Rim2" && json.materials[21]?.name === "Rim1";
  if (!valid) return null;
  const meshIndices = new Set(rimNodes.map(([, mesh]) => mesh));
  const targets = new Map();
  let compatible = true;
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const association = gltf.parser.associations.get(object);
    if (!meshIndices.has(association?.meshes)) return;
    const primitive = association.primitives;
    const key = `${association.meshes}:${primitive}`;
    if (![0, 1].includes(primitive) || targets.has(key) ||
        object.material?.name !== json.materials[20 + primitive].name || !object.material.color?.isColor) {
      compatible = false;
      return;
    }
    targets.set(key, object);
  });
  // Si cambia la estructura del GLB, no modifica ningún material.
  if (!compatible || targets.size !== 8) return null;
  const rimMeshes = new Set(targets.values());
  const otherMaterials = new Set();
  gltf.scene.traverse((object) => {
    if (!object.isMesh || rimMeshes.has(object)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      otherMaterials.add(material);
    }
  });
  const clones = new Map();
  const originals = new Map();
  for (const object of rimMeshes) {
    const source = object.material;
    // Aísla solo materiales compartidos con otras piezas; conserva las texturas.
    if (otherMaterials.has(source)) {
      if (!clones.has(source)) clones.set(source, source.clone());
      object.material = clones.get(source);
    }
    if (!originals.has(object.material)) originals.set(object.material, object.material.color.clone());
  }
  return { originals, targets };
}

// Definiciones independientes de la selección y de la construcción de mallas.
const rimDesignDefinitions = [
  { id: "original" },
  { id: "five-spoke", prefix: "FiveSpokeRim", count: 5, width: 0.10 },
  { id: "multi-spoke", prefix: "MultiSpokeRim", count: 12, width: 0.035 },
  { id: "concave", prefix: "ConcaveRim", count: 5, width: 0.20, concave: true },
  { id: "double-spoke", prefix: "DoubleSpokeRim", count: 5, width: 0.03, paired: true },
  { id: "deep-dish", prefix: "DeepDishRim", count: 12, width: 0.045, dish: true },
  { id: "racing-six", prefix: "RacingSixRim", count: 6, width: 0.15 }
];
const rimMeshIndices = [90, 92, 94, 96];

function getRimBounds(THREE, targets, meshIndex = 90) {
  const bounds = new THREE.Box3();
  for (const part of [targets.get(`${meshIndex}:0`), targets.get(`${meshIndex}:1`)]) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox);
  }
  return bounds;
}

function createRimPlacement(THREE, targets, meshIndex, name) {
  const original = targets.get(`${meshIndex}:0`);
  const replacement = new THREE.Group();
  replacement.name = `${name}${meshIndex}`;
  // Mismo padre y transformación local: conserva giro, escala y centrado.
  replacement.position.copy(original.parent.position);
  replacement.quaternion.copy(original.parent.quaternion);
  replacement.scale.copy(original.parent.scale);
  const design = new THREE.Group();
  // La cara exterior de las ruedas derechas mira hacia -X local.
  if (meshIndex === 92 || meshIndex === 96) design.rotation.y = Math.PI;
  replacement.add(design);
  replacement.visible = false;
  return { replacement, design, parent: original.parent.parent };
}

function activateRimDesign(selected, designs) {
  if (!designs.has(selected)) return false;
  // Solo alterna llantas ya creadas; no toca neumáticos, discos ni frenos.
  for (const [id, rims] of designs) {
    for (const rim of rims) rim.visible = id === selected;
  }
  return true;
}

function createCustomRims(THREE, targets, colors) {
  const parts = [...targets.values()];
  const bounds = getRimBounds(THREE, targets);
  const radius = Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y),
    Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  const innerRadius = radius * 0.94;
  const face = bounds.max.x - radius * 0.08;
  const depth = radius * 0.08;
  // Barril hueco: deja el centro libre para el disco y la pinza originales.
  const profile = [[bounds.min.x, innerRadius], [bounds.min.x, radius],
    [bounds.max.x, radius], [bounds.max.x, innerRadius], [bounds.min.x, innerRadius]];
  const barrelGeometry = new THREE.LatheGeometry(
    profile.map(([x, r]) => new THREE.Vector2(r, x)), 64);
  barrelGeometry.rotateZ(-Math.PI / 2);
  const hubRadius = radius * 0.18;
  const hubGeometry = new THREE.CylinderGeometry(hubRadius, hubRadius, depth, 32);
  hubGeometry.rotateZ(-Math.PI / 2);
  // Todos los diseños comparten barril, centro y material.
  const source = parts.find((part) => part.material.name === "Rim1").material;
  const material = new THREE.MeshStandardMaterial({
    color: colors.get(source), metalness: 0.85, roughness: 0.3
  });
  colors.set(material, material.color.clone());
  const replacements = new Map([["original", parts]]);
  for (const { id, prefix, count, width, concave, paired, dish } of rimDesignDefinitions) {
    if (id === "original") continue;
    const spokeRadius = dish ? radius * 0.80 : innerRadius;
    const spokeLength = spokeRadius - hubRadius + radius * 0.04;
    const spokeDepth = concave ? depth * 0.5 : depth;
    // Una geometría de radio por diseño, reutilizada en las cuatro ruedas.
    const spokeGeometry = new THREE.BoxGeometry(spokeDepth, spokeLength, radius * width);
    if (concave) {
      // Centro hundido respecto al extremo, sin rebasar la cara original.
      const positions = spokeGeometry.attributes.position;
      const rise = Math.min(radius * 0.055, bounds.max.x - face - spokeDepth / 2);
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const progress = (positions.getY(vertex) + spokeLength / 2) / spokeLength;
        positions.setX(vertex, positions.getX(vertex) + progress * rise);
      }
      positions.needsUpdate = true;
      spokeGeometry.computeVertexNormals();
    }
    let dishGeometry;
    if (dish) {
      // Labio profundo hueco: conecta el centro retraído con el aro exterior.
      const dishProfile = [[face - depth / 2, spokeRadius], [face + depth / 2, spokeRadius],
        [bounds.max.x, innerRadius], [bounds.max.x, radius],
        [bounds.max.x - depth / 2, innerRadius], [face - depth / 2, spokeRadius + radius * 0.04],
        [face - depth / 2, spokeRadius]];
      dishGeometry = new THREE.LatheGeometry(
        dishProfile.map(([x, r]) => new THREE.Vector2(r, x)), 64);
      dishGeometry.rotateZ(-Math.PI / 2);
    }
    const rims = [];
    replacements.set(id, rims);
    for (const meshIndex of rimMeshIndices) {
      const { replacement, design, parent } = createRimPlacement(THREE, targets, meshIndex, prefix);
      const barrel = new THREE.Mesh(barrelGeometry, material);
      const hub = new THREE.Mesh(hubGeometry, material);
      hub.position.x = face;
      design.add(barrel, hub);
      if (dishGeometry) design.add(new THREE.Mesh(dishGeometry, material));
      for (let i = 0; i < count; i++) {
        // Cinco parejas separadas angularmente para distinguir los radios dobles.
        for (const offset of paired ? [-0.11, 0.11] : [0]) {
          const angle = i * Math.PI * 2 / count + offset;
          const spoke = new THREE.Mesh(spokeGeometry, material);
          const distance = hubRadius + spokeLength / 2 - radius * 0.02;
          spoke.position.set(face, Math.cos(angle) * distance, Math.sin(angle) * distance);
          spoke.rotation.x = angle;
          design.add(spoke);
        }
      }
      replacement.traverse((object) => {
        if (object.isMesh) object.castShadow = true;
      });
      parent.add(replacement);
      rims.push(replacement);
    }
  }
  return replacements;
}

function createGLBRimLoader(THREE, loader, targets, colors) {
  const loads = new Map();
  // Un GLB debe contener solo una llanta estática; rotation alinea su eje con X.
  return function loadGLBRimDesign({ id, url, rotation = [0, 0, 0] }) {
    if (loads.has(id)) return loads.get(id);
    const pending = (async () => {
      try {
        if (!id || !url || rimDesignDefinitions.some((design) => design.id === id) ||
            !Array.isArray(rotation) || rotation.length !== 3 || !rotation.every(Number.isFinite)) {
          throw new Error("Definición de llanta externa no válida");
        }
        // Usa el mismo GLTFLoader, incluida su configuración KTX2.
        const gltf = await loader.loadAsync(url);
        const template = new THREE.Group();
        const oriented = new THREE.Group();
        oriented.rotation.set(...rotation);
        oriented.add(gltf.scene);
        template.add(oriented);
        let meshCount = 0;
        gltf.scene.traverse((object) => {
          if (!object.isMesh) return;
          if (object.isSkinnedMesh || object.isInstancedMesh) {
            throw new Error("La llanta externa debe usar mallas estáticas");
          }
          meshCount++;
        });
        const bounds = new THREE.Box3().setFromObject(template, true);
        const size = bounds.getSize(new THREE.Vector3());
        if (!meshCount || ![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
          throw new Error("El GLB no contiene una llanta con dimensiones válidas");
        }
        // Centra después de orientar; mantiene proporciones en el plano de radios.
        oriented.position.sub(bounds.getCenter(new THREE.Vector3()));
        const materials = new Map();
        gltf.scene.traverse((object) => {
          if (!object.isMesh) return;
          const isolate = (source) => {
            if (!materials.has(source)) materials.set(source, source.clone());
            return materials.get(source);
          };
          object.material = Array.isArray(object.material)
            ? object.material.map(isolate) : isolate(object.material);
          object.castShadow = true;
        });
        const placements = rimMeshIndices.map((meshIndex) => {
          const placement = createRimPlacement(THREE, targets, meshIndex, id);
          const targetBounds = getRimBounds(THREE, targets, meshIndex);
          const targetSize = targetBounds.getSize(new THREE.Vector3());
          if (![targetSize.x, targetSize.y, targetSize.z].every((value) => Number.isFinite(value) && value > 0)) {
            throw new Error("Dimensiones de llanta original no válidas");
          }
          const radialScale = Math.min(targetSize.y / size.y, targetSize.z / size.z);
          // Las cuatro copias comparten geometrías y materiales aislados del GLB.
          const copy = template.clone(true);
          copy.scale.set(targetSize.x / size.x, radialScale, radialScale);
          copy.position.copy(targetBounds.getCenter(new THREE.Vector3()));
          // Compensa el giro derecho para conservar el centro local original.
          copy.position.applyQuaternion(placement.design.quaternion.clone().invert());
          placement.design.add(copy);
          return placement;
        });
        // Registra materiales y mallas solo cuando todo el diseño está listo.
        for (const material of materials.values()) {
          if (material.color?.isColor) colors.set(material, material.color.clone());
        }
        for (const { parent, replacement } of placements) parent.add(replacement);
        return placements.map(({ replacement }) => replacement);
      } catch (error) {
        console.warn(`No se pudo cargar el diseño de llanta ${id}:`, error);
        return null;
      }
    })();
    // También comparte la promesa entre solicitudes simultáneas del mismo diseño.
    loads.set(id, pending);
    return pending;
  };
}

async function initializeViewer() {
  let renderer, controls, model, observer, textureLoader, floor, keyLight;
  let tireStyles;
  let brakeStyles;
  const changeCaliperColor = (event) => {
    if (event.target.matches('input[name="caliper"]')) {
      applyBrakeStyle(brakeStyles?.caliperStyles, event.target.value);
    }
  };
  const changeDiscFinish = (event) => {
    if (event.target.matches('input[name="disc"]')) {
      if (activateDiscFinish(brakeStyles?.discStyles, event.target.value)) {
        renderer.shadowMap.needsUpdate = true;
      }
    }
  };
  const changeTireStyle = (event) => {
    if (!event.target.matches('input[name="tire"]')) return;
    const assignments = tireStyles?.styles.get(event.target.value);
    if (!assignments) return;
    for (const [object, material] of assignments) object.material = material;
  };
  const paintMaterials = new Set();
  let originalRimColors = new Map();
  let replacementRims = new Map();
  const changeRimDesign = (event) => {
    if (!event.target.matches('input[name="rim-design"]')) return;
    const selected = event.target.value;
    if (!activateRimDesign(selected, replacementRims)) return;
    renderer.shadowMap.needsUpdate = true;
  };
  const rimColors = { black: "#17191c", silver: "#b8bec5", bronze: "#96704a", gold: "#c4a45a" };
  const changeRimColor = (event) => {
    if (!event.target.matches('input[name="rim"]')) return;
    const name = event.target.value;
    if (name !== "original" && !Object.hasOwn(rimColors, name)) return;
    // Solo cambia el color; Original recupera el valor lineal exacto del GLB.
    for (const [material, color] of originalRimColors) {
      if (name === "original") material.color.copy(color);
      else material.color.set(rimColors[name]);
    }
  };
  const originalFinishes = new Map();
  const finishProperties = ["roughness", "metalness", "clearcoat", "clearcoatRoughness"];
  const finishes = {
    matte: { roughness: 0.72, metalness: 0.18, clearcoat: 0.18, clearcoatRoughness: 0.55 },
    glossy: { roughness: 0.23, metalness: 0.18, clearcoat: 0.75, clearcoatRoughness: 0.2 },
    metallic: { roughness: 0.34, metalness: 0.65, clearcoat: 0.55, clearcoatRoughness: 0.28 }
  };
  const changeColor = (event) => {
    if (event.target.matches('input[name="paint"]')) {
      for (const material of paintMaterials) material.color.set(event.target.value);
    }
  };
  const changeFinish = (event) => {
    if (!event.target.matches('input[name="finish"]')) return;
    const name = event.target.value;
    if (name !== "original" && !Object.hasOwn(finishes, name)) return;
    for (const material of paintMaterials) {
      const original = originalFinishes.get(material);
      // Cada acabado parte del original; no acumula cambios ni altera texturas o color.
      for (const property of Object.keys(original)) {
        material[property] = name === "original" ? original[property]
          : Math.min(0.85, Math.max(0.12, original[property] * 0.25 + finishes[name][property] * 0.75));
      }
      // Clearcoat puede activar una variante del shader del material físico.
      material.needsUpdate = true;
    }
  };
  function dispose() {
    renderer?.setAnimationLoop(null);
    observer?.disconnect();
    controls?.dispose();
    const materials = new Set();
    const geometries = new Set();
    const textures = new Set();
    model?.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    // Incluye variantes inactivas y mapas originales al liberar el visor.
    for (const material of tireStyles?.materials ?? []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    for (const material of brakeStyles?.materials ?? []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    floor?.geometry.dispose();
    floor?.material.dispose();
    keyLight?.shadow.dispose();
    textureLoader?.dispose();
    renderer?.dispose();
    renderer?.domElement.remove();
    paintSelector.removeEventListener("change", changeColor);
    finishSelector.removeEventListener("change", changeFinish);
    rimSelector.removeEventListener("change", changeRimColor);
    rimDesignSelector.removeEventListener("change", changeRimDesign);
    tireSelector.removeEventListener("change", changeTireStyle);
    caliperSelector.removeEventListener("change", changeCaliperColor);
    discSelector.removeEventListener("change", changeDiscFinish);
    paintSelector.disabled = true;
    finishSelector.disabled = true;
    rimSelector.disabled = true;
    rimDesignSelector.disabled = true;
    tireSelector.disabled = true;
    caliperSelector.disabled = true;
    discSelector.disabled = true;
  }
  try {
    // El import map fija una misma versión para los módulos.
    const [THREE, { OrbitControls }, { GLTFLoader }, { KTX2Loader }] = await Promise.all([
      import("three"), import("three/addons/controls/OrbitControls.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/loaders/KTX2Loader.js")
    ]);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111318");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(4, 2.4, 5);
    // Luz suave y acentos cálidos/fríos para destacar la carrocería.
    // Relleno suave para conservar detalle en las zonas oscuras.
    scene.add(new THREE.HemisphereLight(0xe6edff, 0x343238, 0.85));
    keyLight = new THREE.DirectionalLight(0xfff1e3, 2.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    const fillLight = new THREE.DirectionalLight(0xd0dfff, 1.35);
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.6);
    scene.add(keyLight, fillLight, rimLight);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    // Solo la luz principal genera sombras suaves de coste moderado.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label", "CarConcept, coche 3D de demostración: arrastra para rotar y usa la rueda para acercar");
    viewer.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    let radius = 1;
    let fittedAspect = null;
    const framingCorners = [];
    function fitCamera() {
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontal = Math.atan(Math.tan(halfFov) * camera.aspect);
      const direction = camera.position.clone().sub(controls.target).normalize();
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      // Proyecta la caja: respeta ambos ejes y deja un 8 % de margen.
      let distance = radius * 1.2;
      for (const corner of framingCorners) {
        const offset = corner.clone().sub(controls.target);
        const depth = offset.dot(direction);
        distance = Math.max(distance,
          depth + Math.abs(offset.dot(right)) * 1.08 / Math.tan(horizontal),
          depth + Math.abs(offset.dot(up)) * 1.08 / Math.tan(halfFov));
      }
      camera.position.copy(controls.target).addScaledVector(direction, distance);
      controls.minDistance = radius * 1.2;
      // Conserva el alcance de zoom anterior, basado en la esfera envolvente.
      controls.maxDistance = radius / Math.sin(Math.min(halfFov, horizontal)) * 1.08 * 4;
      camera.near = radius / 100;
      camera.far = controls.maxDistance * 2.5 + radius;
      camera.updateProjectionMatrix();
      controls.update();
    }
    // Ajusta cámara y resolución al tamaño real del contenedor.
    observer = new ResizeObserver(() => {
      const { width, height } = viewer.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (model && fittedAspect !== camera.aspect) {
        fitCamera();
        fittedAspect = camera.aspect;
      }
    });
    observer.observe(viewer);
    // CarConcept contiene texturas KTX2 incrustadas: requiere Basis Universal.
    textureLoader = new KTX2Loader()
      .setTranscoderPath("https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/basis/")
      .detectSupport(renderer);
    const loader = new GLTFLoader().setKTX2Loader(textureLoader);
    paintStatus.textContent = "Cargando CarConcept...";
    viewer.setAttribute("aria-busy", "true");
    const gltf = await loader.loadAsync("/assets/modelos/CarConcept.glb", (event) => {
      if (event.total) paintStatus.textContent = `Cargando CarConcept: ${Math.round(event.loaded / event.total * 100)} %`;
    });
    model = gltf.scene;
    brakeStyles = prepareBrakeStyles(THREE, gltf);
    if (brakeStyles) {
      caliperSelector.disabled = false;
      caliperSelector.addEventListener("change", changeCaliperColor);
      changeCaliperColor({ target: caliperSelector.querySelector("input:checked") });
      discSelector.disabled = !brakeStyles.discGeometryValid;
      if (brakeStyles.discGeometryValid) {
        discSelector.addEventListener("change", changeDiscFinish);
        changeDiscFinish({ target: discSelector.querySelector("input:checked") });
      }
      brakeStatus.textContent = brakeStyles.discGeometryValid
        ? "Pinzas y discos independientes. Perforado: agujeros pasantes; Ranurado: canales con fondo; combinado: ambos. Los detalles pueden quedar ocultos por la llanta según el ángulo."
        : "Colores de pinzas disponibles. La geometría de los discos no permite alternativas seguras; se conserva Original.";
    } else {
      brakeStatus.textContent = "No se pudieron identificar los frenos con seguridad. Controles desactivados.";
    }
    tireStyles = prepareTireStyles(THREE, gltf);
    if (tireStyles) {
      tireSelector.disabled = false;
      tireSelector.addEventListener("change", changeTireStyle);
      changeTireStyle({ target: tireSelector.querySelector("input:checked") });
      tireStatus.textContent = "Deportivo: chevrones y flanco discreto; Semislick: surcos reducidos y letras blancas; Slick: banda lisa, letras y franja amarilla. Relieve simulado por textura, sin cambiar la geometría.";
    } else {
      tireStatus.textContent = "No se pudieron identificar los flancos y la rodadura con seguridad. Controles desactivados.";
    }
    const rimMaterials = prepareRimMaterials(gltf);
    if (rimMaterials) {
      originalRimColors = rimMaterials.originals;
      replacementRims = createCustomRims(THREE, rimMaterials.targets, originalRimColors);
      // Futuro GLB: crear createGLBRimLoader con loader, targets y originalRimColors;
      // registrar su resultado en replacementRims y reaplicar changeRimColor.
      rimDesignSelector.disabled = false;
      rimDesignSelector.addEventListener("change", changeRimDesign);
      changeRimDesign({ target: rimDesignSelector.querySelector("input:checked") });
      rimSelector.disabled = false;
      rimSelector.addEventListener("change", changeRimColor);
      changeRimColor({ target: rimSelector.querySelector("input:checked") });
      rimStatus.textContent = "Elige diseño y color de llantas; el color Original restaura el acabado de cada diseño.";
    } else {
      rimStatus.textContent = "No se pudieron identificar las llantas con seguridad. Controles desactivados.";
      const candidates = [];
      model.traverse((object) => {
        if (!object.isMesh) return;
        candidates.push({ mesh: object.name, materials: (Array.isArray(object.material)
          ? object.material : [object.material]).map((material) => material.name) });
      });
      console.warn("Revisar mallas y materiales para identificar las llantas:", candidates);
    }
    // Lista explícita verificada en el GLB, sin seleccionar interiores por color.
    const paintNames = new Set(["Paint 1 Carmine", "Paint 2 Carmine"]);
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      if (!object.name.startsWith("Body")) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!paintNames.has(material.name) || paintMaterials.has(material)) continue;
        paintMaterials.add(material);
        // Guarda solo propiedades numéricas compatibles antes de personalizar.
        originalFinishes.set(material, Object.freeze(Object.fromEntries(
          finishProperties.filter((property) => Number.isFinite(material[property]))
            .map((property) => [property, material[property]])
        )));
      }
    });
    // Conserva la geometría y las texturas originales del modelo.
    const bounds = new THREE.Box3().setFromObject(model, true);
    if (bounds.isEmpty()) throw new Error("El modelo no contiene geometría visible");
    const center = bounds.getCenter(new THREE.Vector3());
    radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    model.position.sub(center);
    scene.add(model);
    // Un objetivo algo más bajo eleva el coche y reduce el vacío inferior.
    controls.target.set(0, -(bounds.max.y - bounds.min.y) * 0.08, 0);
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          framingCorners.push(new THREE.Vector3(x, y, z).sub(center));
        }
      }
    }
    // El mínimo del modelo centrado sitúa el suelo bajo las ruedas.
    const floorY = bounds.min.y - center.y;
    floor = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 12, radius * 12),
      // Antracita mate: reduce reflejos del suelo sin bajar la luz del coche.
      new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 1, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY - radius * 0.0002;
    floor.receiveShadow = true;
    scene.add(floor);

    // Escala luces y cámara de sombras al tamaño real del coche.
    keyLight.position.set(radius * 1.5, radius * 2.5, radius * 1.5);
    fillLight.position.set(-radius * 2, radius, radius);
    rimLight.position.set(radius, radius * 1.5, -radius * 2);
    const shadowCamera = keyLight.shadow.camera;
    shadowCamera.left = shadowCamera.bottom = -radius * 1.25;
    shadowCamera.right = shadowCamera.top = radius * 1.25;
    shadowCamera.near = radius * 0.1;
    shadowCamera.far = radius * 7;
    shadowCamera.updateProjectionMatrix();
    // Menor separación y sesgo para reforzar el contacto bajo las ruedas.
    keyLight.shadow.bias = -0.00005;
    keyLight.shadow.normalBias = radius * 0.001;
    // La escena es estática: recalcula sombras solo en el primer fotograma.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    const { width, height } = viewer.getBoundingClientRect();
    camera.aspect = width / Math.max(height, 1);
    fitCamera();
    fittedAspect = camera.aspect;
    viewer.setAttribute("aria-busy", "false");
    paintSelector.addEventListener("change", changeColor);
    finishSelector.addEventListener("change", changeFinish);
    paintSelector.disabled = paintMaterials.size === 0;
    finishSelector.disabled = paintMaterials.size === 0;
    if (paintMaterials.size) {
      changeColor({ target: paintSelector.querySelector("input:checked") });
      changeFinish({ target: finishSelector.querySelector("input:checked") });
      paintStatus.textContent = "CarConcept cargado. Combina color y acabado exterior, arrastra para rotar y usa la rueda o un gesto de pinza para hacer zoom.";
    } else {
      paintStatus.textContent = "Modelo cargado, pero no se encontraron materiales de pintura compatibles.";
    }
    // Un único bucle de renderizado y actualización de controles.
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) dispose();
    });
  } catch (error) {
    dispose();
    viewer.setAttribute("aria-busy", "false");
    paintStatus.textContent = "No se pudo cargar CarConcept. Comprueba /assets/modelos/CarConcept.glb, la conexión al CDN y la compatibilidad con WebGL.";
    console.error("Error del visor 3D:", error);
  }
}

initializeViewer();

async function loadSelectedCar() {
  const parameters = new URLSearchParams(window.location.search);
  const id = parameters.get("id");
  const game = parameters.get("game");

  if (!id || !game) {
    vehicleStatus.textContent = "Falta el coche o el juego. Vuelve al catálogo y selecciona PERSONALIZAR en una ficha.";
    return;
  }

  try {
    // El catálogo incluye imagen y juego; la ficha solo devuelve wikitext.
    const response = await fetch(`/api/cars?${new URLSearchParams({ game })}`);
    if (!response.ok) {
      vehicleStatus.textContent = response.status === 400
        ? "El juego seleccionado no está disponible. Vuelve al catálogo."
        : "No se pudo cargar el vehículo desde la API. Vuelve al catálogo e inténtalo de nuevo.";
      return;
    }

    const cars = await response.json();
    if (!Array.isArray(cars)) throw new Error("Catálogo no válido");
    // Compara el identificador real de la API con el parámetro de URL.
    const car = cars.find((item) => String(item.id) === id);
    if (!car) {
      vehicleStatus.textContent = "El coche no existe en el catálogo del juego seleccionado. Vuelve al catálogo.";
      return;
    }

    document.querySelector("#panel-title").textContent = car.title;
    document.querySelector("#vehicle-game").textContent = `NEED FOR SPEED: ${car.gameLabel}`;
    vehicle.hidden = false;
    vehicleStatus.textContent = "Vehículo seleccionado. La personalización estará disponible próximamente.";

    if (car.image) {
      vehicleImage.addEventListener("error", () => {
        vehicleImage.hidden = true;
        imageStatus.hidden = false;
      }, { once: true });
      vehicleImage.alt = `Imagen de ${car.title}`;
      vehicleImage.hidden = false;
      vehicleImage.src = car.image;
    } else {
      imageStatus.hidden = false;
    }

  } catch {
    vehicleStatus.textContent = "No se pudo cargar el vehículo desde la API. Vuelve al catálogo e inténtalo de nuevo.";
  }
}

loadSelectedCar();

