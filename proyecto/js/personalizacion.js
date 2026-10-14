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

function createFiveSpokeRims(THREE, targets, colors) {
  const parts = [...targets.values()];
  const bounds = new THREE.Box3();
  for (const part of [targets.get("90:0"), targets.get("90:1")]) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox);
  }
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
  const spokeLength = innerRadius - hubRadius + radius * 0.04;
  const spokeGeometry = new THREE.BoxGeometry(depth, spokeLength, radius * 0.10);
  const source = parts.find((part) => part.material.name === "Rim1").material;
  const material = new THREE.MeshStandardMaterial({
    color: colors.get(source), metalness: 0.85, roughness: 0.3
  });
  colors.set(material, material.color.clone());
  const replacements = [];
  for (const meshIndex of [90, 92, 94, 96]) {
    const original = targets.get(`${meshIndex}:0`);
    const replacement = new THREE.Group();
    replacement.name = `FiveSpokeRim${meshIndex}`;
    // Mismo padre y transformación local: conserva giro, escala y centrado.
    replacement.position.copy(original.parent.position);
    replacement.quaternion.copy(original.parent.quaternion);
    replacement.scale.copy(original.parent.scale);
    const design = new THREE.Group();
    // La cara exterior de las ruedas derechas mira hacia -X local.
    if (meshIndex === 92 || meshIndex === 96) design.rotation.y = Math.PI;
    replacement.add(design);
    const barrel = new THREE.Mesh(barrelGeometry, material);
    const hub = new THREE.Mesh(hubGeometry, material);
    hub.position.x = face;
    design.add(barrel, hub);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      const spoke = new THREE.Mesh(spokeGeometry, material);
      const distance = hubRadius + spokeLength / 2 - radius * 0.02;
      spoke.position.set(face, Math.cos(angle) * distance, Math.sin(angle) * distance);
      spoke.rotation.x = angle;
      design.add(spoke);
    }
    replacement.traverse((object) => {
      if (object.isMesh) object.castShadow = true;
    });
    replacement.visible = false;
    original.parent.parent.add(replacement);
    replacements.push(replacement);
  }
  return replacements;
}

async function initializeViewer() {
  let renderer, controls, model, observer, textureLoader, floor, keyLight;
  const paintMaterials = new Set();
  let originalRimColors = new Map();
  let originalRimParts = [];
  let replacementRims = [];
  const changeRimDesign = (event) => {
    if (!event.target.matches('input[name="rim-design"]')) return;
    if (!["original", "five-spoke"].includes(event.target.value)) return;
    const custom = event.target.value === "five-spoke";
    // Oculta solo las ocho primitivas; conserva neumáticos, discos y frenos.
    for (const part of originalRimParts) part.visible = !custom;
    for (const replacement of replacementRims) replacement.visible = custom;
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
    paintSelector.disabled = true;
    finishSelector.disabled = true;
    rimSelector.disabled = true;
    rimDesignSelector.disabled = true;
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
    const rimMaterials = prepareRimMaterials(gltf);
    if (rimMaterials) {
      originalRimColors = rimMaterials.originals;
      originalRimParts = [...rimMaterials.targets.values()];
      replacementRims = createFiveSpokeRims(THREE, rimMaterials.targets, originalRimColors);
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

