# Need for Speed Tuning Garage

Página fan educativa con coches de carreras de Need for Speed: Most Wanted (2005), Carbon y Underground 2, cargados desde la Need for Speed Wiki. El garaje permite elegir un juego, filtrar coches por nombre y abrir la ficha de cada vehículo.

## Ejecutar

1. Instala [Node.js](https://nodejs.org/).
2. En la raíz del proyecto, ejecuta `npm install`.
3. Ejecuta `npm start`.
4. Abre `http://localhost:3000`.

No se necesita una clave API. El servidor Node.js sirve la página y consulta la API pública de MediaWiki de Fandom. Para Underground 2 se parte de la categoría de vehículos del juego y se excluye la categoría de vehículos de tráfico.

## Organización

- `proyecto/html/index.html`: página principal del garaje, selector de juego, filtro y ventana de detalle.
- `proyecto/css/styles.css`: presentación visual y adaptación a pantallas pequeñas.
- `proyecto/js/script.js`: carga el catálogo seleccionado, filtra coches y crea tarjetas y fichas.
- `server.js`: sirve los archivos, consulta las categorías de cada juego y devuelve las fichas de coches.

## Categorías y datos de las fichas

- Most Wanted (2005): `Stock (Most Wanted (2005))`.
- Carbon: `Stock (Carbon)`.
- Underground 2: `Vehicles (Underground 2)`, excluyendo `Traffic Vehicles (Underground 2)`.

Las páginas de la wiki pueden incluir una plantilla `InfoboxCar`. La ficha presenta los valores disponibles de `production`, `manufacturer`, `eng`, `disp`, `weight`, `bhp`, `torque`, `accel`, `top speed`, `transmission2` y `transmission`. La cobertura puede variar entre coches y juegos.

La wiki es comunitaria y no oficial; sus datos pueden cambiar. La página enlaza a la fuente original y no está afiliada a Electronic Arts.
