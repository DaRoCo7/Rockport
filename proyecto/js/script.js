"use strict";

const carList = document.querySelector("#car-list");
const carCount = document.querySelector("#car-count");
const carFilter = document.querySelector("#car-filter");
const gameSelect = document.querySelector("#game-select");
const gameEdition = document.querySelector("#game-edition");
const statusMessage = document.querySelector("#status-message");
const carDialog = document.querySelector("#car-dialog");
const dialogContent = document.querySelector("#dialog-content");
const closeDialogButton = document.querySelector("#close-dialog");

let cars = [];

carFilter.addEventListener("input", filterCars);
gameSelect.addEventListener("change", () => {
  const selectedGame = gameSelect.selectedOptions[0];
  gameEdition.textContent = getGameEdition(gameSelect.value);
  document.querySelector("#garage-title").textContent = `Coches de ${selectedGame.textContent}`;
  carFilter.value = "";
  loadCars(gameSelect.value);
});
closeDialogButton.addEventListener("click", () => carDialog.close());
carDialog.addEventListener("click", closeDialogFromBackdrop);

loadCars(gameSelect.value);

async function loadCars(gameId) {
  cars = [];
  carList.replaceChildren();
  carCount.textContent = "";
  showStatus("Cargando los coches del juego...");

  try {
    const parameters = new URLSearchParams({ game: gameId });
    const response = await fetch(`/api/cars?${parameters}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || `No se pudo cargar el catálogo (${response.status}).`);
    }

    if (!Array.isArray(payload)) {
      throw new Error("El servidor no ha devuelto una lista de coches.");
    }

    cars = payload;
    renderCars(cars);
    showStatus("");
  } catch (error) {
    console.error("Error al cargar el catálogo:", error);
    showStatus(error.message, true);
  }
}

function getGameEdition(gameId) {
  const editions = {
    "most-wanted-2005": "ROCKPORT · MOST WANTED 2005",
    carbon: "PALMONT CITY · CARBON",
    "underground-2": "BAYVIEW · UNDERGROUND 2"
  };

  return editions[gameId] || "NEED FOR SPEED · TUNING GARAGE";
}

function renderCars(carsToRender) {
  const cards = carsToRender.map(createCarCard);
  carList.replaceChildren(...cards);
  carCount.textContent = `${carsToRender.length} ${carsToRender.length === 1 ? "coche" : "coches"}`;

  if (cars.length > 0 && carsToRender.length === 0) {
    showStatus("No hay coches que coincidan con ese filtro.");
  } else if (carsToRender.length > 0) {
    showStatus("");
  }
}

function createCarCard(car) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "car-card";
  card.setAttribute("aria-label", `Ver ficha de ${car.title}`);
  card.addEventListener("click", () => openCarDetails(car));

  const imageWrap = document.createElement("span");
  imageWrap.className = "car-card__image-wrap";

  if (car.image) {
    const image = document.createElement("img");
    image.className = "car-card__image";
    image.src = car.image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      image.remove();
      imageWrap.classList.add("car-card__image-wrap--empty");
      imageWrap.textContent = "IMAGEN NO DISPONIBLE";
    }, { once: true });
    imageWrap.append(image);
  } else {
    imageWrap.classList.add("car-card__image-wrap--empty");
    imageWrap.textContent = "IMAGEN NO DISPONIBLE";
  }

  const caption = document.createElement("span");
  caption.className = "car-card__caption";

  const title = document.createElement("span");
  title.className = "car-card__title";
  title.textContent = car.title;

  const action = document.createElement("span");
  action.className = "car-card__action";
  action.textContent = "VER FICHA  ↗";

  caption.append(title, action);
  card.append(imageWrap, caption);
  return card;
}

function filterCars() {
  const query = carFilter.value.trim().toLocaleLowerCase("es");
  const filteredCars = cars.filter((car) =>
    car.title.toLocaleLowerCase("es").includes(query)
  );

  renderCars(filteredCars);
}

async function openCarDetails(car) {
  dialogContent.replaceChildren(createLoadingDetails(car));
  carDialog.showModal();

  try {
    const response = await fetch(`/api/cars/${encodeURIComponent(car.id)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || `No se pudo cargar la ficha (${response.status}).`);
    }

    const details = readInfobox(payload.wikitext);
    dialogContent.replaceChildren(createCarDetails(car, details, payload.source));
  } catch (error) {
    console.error(`Error al cargar la ficha de ${car.title}:`, error);
    dialogContent.replaceChildren(createErrorDetails(car, error.message));
  }
}

function readInfobox(wikitext) {
  const infobox = wikitext.match(/\{\{InfoboxCar([\s\S]*?)\}\}/i);
  if (!infobox) {
    throw new Error("La página no contiene una ficha de coche reconocible.");
  }

  const fields = {};
  const fieldPattern = /^\s*\|\s*([^=]+?)\s*=\s*(.*?)\s*$/gm;

  for (const match of infobox[1].matchAll(fieldPattern)) {
    fields[match[1].trim().toLowerCase()] = cleanWikiValue(match[2]);
  }

  return fields;
}

function cleanWikiValue(value) {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/''+/g, "")
    .trim();
}

function formatManufacturer(manufacturer) {
  const normalized = manufacturer.toLowerCase();
  const aliases = {
    aston: "Aston Martin",
    bmw: "BMW",
    vw: "Volkswagen"
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  return manufacturer.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function createCarDetails(car, details, source) {
  const wrapper = document.createElement("article");
  wrapper.className = "detail";

  const image = document.createElement("img");
  image.className = "detail__image";
  image.src = car.image;
  image.alt = `Imagen de ${car.title}`;
  image.hidden = !car.image;

  const content = document.createElement("div");
  content.className = "detail__content";

  const gameLabel = document.createElement("p");
  gameLabel.className = "eyebrow";
  gameLabel.textContent = `NEED FOR SPEED: ${car.gameLabel}`;

  const title = document.createElement("h2");
  title.id = "dialog-title";
  title.className = "detail__title";
  title.textContent = car.title;

  const facts = document.createElement("dl");
  facts.className = "detail__facts";
  addFact(facts, "Marca", formatManufacturer(details.manufacturer));
  addFact(facts, "Año", details.production);
  addFact(facts, "Motor", details.eng);
  addFact(facts, "Cilindrada", details.disp ? `${details.disp} L` : "");
  addFact(facts, "Potencia", details.bhp ? `${details.bhp} bhp` : "");
  addFact(facts, "Par motor", details.torque ? `${details.torque} lb·ft` : "");
  addFact(facts, "Aceleración", details.accel ? `${details.accel} s` : "");
  addFact(facts, "Velocidad máxima", details["top speed"] ? `${details["top speed"]} mph` : "");
  addFact(facts, "Peso", details.weight ? `${details.weight} kg` : "");
  addFact(facts, "Transmisión", details.transmission2);
  addFact(facts, "Marchas", details.transmission);

  const sourceLink = document.createElement("a");
  sourceLink.className = "detail__source";
  sourceLink.href = source;
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener noreferrer";
  sourceLink.textContent = "Consultar la ficha original de la wiki ↗";

  content.append(gameLabel, title, facts, sourceLink);
  wrapper.append(image, content);
  return wrapper;
}

function createLoadingDetails(car) {
  const wrapper = document.createElement("div");
  wrapper.className = "detail-loading";

  const title = document.createElement("h2");
  title.id = "dialog-title";
  title.textContent = car.title;

  const message = document.createElement("p");
  message.textContent = "Cargando datos del coche...";

  wrapper.append(title, message);
  return wrapper;
}

function createErrorDetails(car, message) {
  const wrapper = document.createElement("div");
  wrapper.className = "detail-loading";

  const title = document.createElement("h2");
  title.id = "dialog-title";
  title.textContent = car.title;

  const error = document.createElement("p");
  error.className = "status-message status-message--error";
  error.textContent = message;

  wrapper.append(title, error);
  return wrapper;
}

function addFact(list, label, value) {
  const item = document.createElement("div");
  item.className = "detail__fact";

  const term = document.createElement("dt");
  term.textContent = label;

  const description = document.createElement("dd");
  description.textContent = value || "No disponible";

  item.append(term, description);
  list.append(item);
}

function closeDialogFromBackdrop(event) {
  if (event.target === carDialog) {
    carDialog.close();
  }
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("status-message--error", isError);
}
