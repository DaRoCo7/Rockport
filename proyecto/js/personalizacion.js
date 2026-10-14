"use strict";

const vehicleStatus = document.querySelector("#vehicle-status");
const vehicle = document.querySelector("#vehicle");
const vehicleImage = document.querySelector("#vehicle-image");
const imageStatus = document.querySelector("#vehicle-image-status");
const viewer = document.querySelector("#car-viewer");
const paintSelector = document.querySelector("#paint-selector");
const finishSelector = document.querySelector("#finish-selector");
const paintStatus = document.querySelector("#paint-status");

async function initializeViewer() {
  let renderer, controls, model, observer, textureLoader, floor, keyLight;
  const paintMaterials = new Set();
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
    const textures = new Set();
    model?.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
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
    paintSelector.disabled = true;
    finishSelector.disabled = true;
  }
  try {
    // El import map fija una misma versión para los módulos.
    const [THREE, { OrbitControls }, { GLTFLoader }, { KTX2Loader }] = await Promise.all([
      import("three"), import("three/addons/controls/OrbitControls.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/loaders/KTX2Loader.js")
    ]);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#151619");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(4, 3, 5);
    // Luz suave y acentos cálidos/fríos para destacar la carrocería.
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    keyLight = new THREE.DirectionalLight(0xfff1da, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    const fillLight = new THREE.DirectionalLight(0xc2d5ff, 1.1);
    const rimLight = new THREE.DirectionalLight(0xffffff, 2);
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
    function fitCamera() {
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontal = Math.atan(Math.tan(halfFov) * camera.aspect);
      // Acerca el coche conservando un margen alrededor de su esfera envolvente.
      const distance = radius / Math.sin(Math.min(halfFov, horizontal)) * 1.08;
      const direction = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(direction.multiplyScalar(distance));
      controls.target.set(0, 0, 0);
      controls.minDistance = radius * 1.2;
      controls.maxDistance = distance * 4;
      camera.near = radius / 100;
      camera.far = distance * 10 + radius;
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

