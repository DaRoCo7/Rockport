"use strict";

const vehicleStatus = document.querySelector("#vehicle-status");
const vehicle = document.querySelector("#vehicle");
const vehicleImage = document.querySelector("#vehicle-image");
const imageStatus = document.querySelector("#vehicle-image-status");
const paintCanvas = document.querySelector("#paint-canvas");
const paintSelector = document.querySelector("#paint-selector");
const paintStatus = document.querySelector("#paint-status");

// Registro por juego e ID: añadir únicamente recursos reales revisados.
// Cada entrada contiene { base, mask } con URLs locales servidas por Express.
// Máscara: mismo tamaño que la base, alfa 0 fuera y alfa 255 en pintura.
const paintResources = new Map();
let paintData = null;

function loadLocalImage(url) {
  const resource = new URL(url, window.location.href);
  if (resource.origin !== window.location.origin) {
    return Promise.reject(new Error("El recurso debe ser local"));
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Recurso no disponible"));
    image.src = resource.href;
  });
}

async function preparePaint(car) {
  const resources = paintResources.get(`${car.gameId}:${car.id}`);
  if (!resources) return;

  try {
    const [base, mask] = await Promise.all([
      loadLocalImage(resources.base), loadLocalImage(resources.mask)
    ]);
    const width = base.naturalWidth;
    const height = base.naturalHeight;
    if (!width || !height || width !== mask.naturalWidth || height !== mask.naturalHeight) {
      throw new Error("Dimensiones incompatibles");
    }
    const buffer = document.createElement("canvas");
    buffer.width = width;
    buffer.height = height;
    const context = buffer.getContext("2d", { willReadFrequently: true });
    if (!context || !paintCanvas.getContext("2d")) throw new Error("Canvas no disponible");
    context.drawImage(base, 0, 0);
    const original = context.getImageData(0, 0, width, height);
    context.clearRect(0, 0, width, height);
    context.drawImage(mask, 0, 0);
    const maskPixels = context.getImageData(0, 0, width, height).data;
    let painted = false;
    let excluded = false;
    for (let i = 3; i < maskPixels.length; i += 4) {
      painted ||= maskPixels[i] > 0;
      excluded ||= maskPixels[i] === 0;
    }
    if (!painted || !excluded) throw new Error("Máscara vacía o sin transparencia exterior");
    paintCanvas.width = width;
    paintCanvas.height = height;
    paintData = { original, maskPixels };
    renderPaint(paintSelector.querySelector("input:checked").value);
    paintCanvas.setAttribute("aria-label", `Vista de pintura de ${car.title}`);
    paintCanvas.hidden = false;
    vehicleImage.hidden = true;
    imageStatus.hidden = true;
    paintSelector.disabled = false;
    paintStatus.textContent = "Pintura disponible. Selecciona un color para verlo al instante.";
  } catch {
    paintData = null;
    paintSelector.disabled = true;
    paintCanvas.hidden = true;
    paintStatus.textContent = "Pintura no disponible: no se pudieron validar o cargar los recursos locales. Se mantiene la imagen original.";
  }
}

function renderPaint(hex) {
  if (!paintData) return;
  const context = paintCanvas.getContext("2d");
  const { original, maskPixels } = paintData;
  const output = context.createImageData(original.width, original.height);
  output.data.set(original.data);
  const color = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  // Conserva luminancia y mezcla solo donde la máscara tiene alfa.
  for (let i = 0; i < output.data.length; i += 4) {
    const coverage = maskPixels[i + 3] / 255;
    if (!coverage) continue;
    const light = (0.2126 * original.data[i] + 0.7152 * original.data[i + 1] + 0.0722 * original.data[i + 2]) / 255;
    const shade = Math.min(light / 0.5, 1);
    const highlight = Math.max((light - 0.5) / 0.5, 0);
    for (let channel = 0; channel < 3; channel++) {
      const tinted = color[channel] * shade * (1 - highlight) + 255 * highlight;
      output.data[i + channel] = original.data[i + channel] * (1 - coverage) + tinted * coverage;
    }
  }
  context.putImageData(output, 0, 0);
}

paintSelector.addEventListener("change", (event) => {
  if (event.target.matches('input[name="paint"]')) renderPaint(event.target.value);
});

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
    await preparePaint(car);
  } catch {
    vehicleStatus.textContent = "No se pudo cargar el vehículo desde la API. Vuelve al catálogo e inténtalo de nuevo.";
  }
}

loadSelectedCar();
