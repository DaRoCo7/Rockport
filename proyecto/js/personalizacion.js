"use strict";

const vehicleStatus = document.querySelector("#vehicle-status");
const vehicle = document.querySelector("#vehicle");
const vehicleImage = document.querySelector("#vehicle-image");
const imageStatus = document.querySelector("#vehicle-image-status");
const viewer = document.querySelector("#car-viewer");
const paintSelector = document.querySelector("#paint-selector");
const paintStatus = document.querySelector("#paint-status");

async function initializeViewer() {
  let renderer, controls, model, observer, textureLoader;
  const paintMaterials = new Set();
  const changeColor = (event) => {
    if (event.target.matches('input[name="paint"]')) {
      for (const material of paintMaterials) material.color.set(event.target.value);
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
    textureLoader?.dispose();
    renderer?.dispose();
    renderer?.domElement.remove();
    paintSelector.removeEventListener("change", changeColor);
    paintSelector.disabled = true;
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
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(4, 6, 3);
    scene.add(light);
    renderer = new THREE.WebGLRenderer({ antialias: true });
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
      const distance = radius / Math.sin(Math.min(halfFov, horizontal)) * 1.15;
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
      if (!object.isMesh || !object.name.startsWith("Body")) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (paintNames.has(material.name)) paintMaterials.add(material);
      }
    });
    // Solo cambia color; conserva clearcoat, rugosidad, metal y texturas originales.
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error("El modelo no contiene geometría visible");
    const center = bounds.getCenter(new THREE.Vector3());
    radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    model.position.sub(center);
    scene.add(model);
    const { width, height } = viewer.getBoundingClientRect();
    camera.aspect = width / Math.max(height, 1);
    fitCamera();
    fittedAspect = camera.aspect;
    viewer.setAttribute("aria-busy", "false");
    paintSelector.addEventListener("change", changeColor);
    paintSelector.disabled = paintMaterials.size === 0;
    if (paintMaterials.size) {
      changeColor({ target: paintSelector.querySelector("input:checked") });
      paintStatus.textContent = "CarConcept cargado. Cambia la pintura exterior, arrastra para rotar y usa la rueda o un gesto de pinza para hacer zoom.";
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

