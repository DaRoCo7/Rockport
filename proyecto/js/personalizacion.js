"use strict";

const vehicleStatus = document.querySelector("#vehicle-status");
const vehicle = document.querySelector("#vehicle");
const vehicleImage = document.querySelector("#vehicle-image");
const imageStatus = document.querySelector("#vehicle-image-status");
const viewer = document.querySelector("#car-viewer");
const paintSelector = document.querySelector("#paint-selector");
const paintStatus = document.querySelector("#paint-status");

async function initializeViewer() {
  let renderer, controls, geometry, material, observer;
  const changeColor = (event) => {
    if (event.target.matches('input[name="paint"]')) material.color.set(event.target.value);
  };
  function dispose() {
    renderer?.setAnimationLoop(null);
    observer?.disconnect();
    controls?.dispose();
    geometry?.dispose();
    material?.dispose();
    renderer?.dispose();
    renderer?.domElement.remove();
    paintSelector.removeEventListener("change", changeColor);
    paintSelector.disabled = true;
  }
  try {
    // El import map fija una misma versión para los módulos.
    const [THREE, { OrbitControls }] = await Promise.all([
      import("three"), import("three/addons/controls/OrbitControls.js")
    ]);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#151619");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(4, 3, 5);
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(4, 6, 3);
    scene.add(light);
    geometry = new THREE.BoxGeometry(2, 2, 2);
    material = new THREE.MeshStandardMaterial({
      color: paintSelector.querySelector("input:checked").value,
      metalness: 0.25, roughness: 0.35
    });
    scene.add(new THREE.Mesh(geometry, material));
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.domElement.setAttribute("aria-label", "Cubo de prueba 3D: arrastra para rotar y usa la rueda para acercar");
    viewer.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3;
    controls.maxDistance = 12;
    // Ajusta cámara y resolución al tamaño real del contenedor.
    observer = new ResizeObserver(() => {
      const { width, height } = viewer.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    observer.observe(viewer);
    paintSelector.addEventListener("change", changeColor);
    paintSelector.disabled = false;
    paintStatus.textContent = "Visor de prueba: los colores se aplican al cubo. Arrastra para rotar y usa la rueda o un gesto de pinza para hacer zoom.";
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
    paintStatus.textContent = "No se pudo iniciar el visor 3D. Comprueba la conexión al CDN y la compatibilidad del navegador con WebGL.";
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

