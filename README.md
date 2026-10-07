# Most Wanted Garage

Página fan educativa con los 32 coches de carreras de la categoría `Stock (Most Wanted (2005))` de la Need for Speed Wiki. El catálogo muestra tarjetas con imágenes; al seleccionar una se carga su ficha.

## Ejecutar

1. Instala [Node.js](https://nodejs.org/).
2. En la raíz del proyecto, ejecuta `npm install`.
3. Ejecuta `npm start`.
4. Abre `http://localhost:3000`.

No se necesita una clave API. El servidor Node.js sirve la página y consulta la API pública de MediaWiki de Fandom.

## Organización

- `proyecto/html/index.html`: página principal del garaje, filtro y ventana de detalle.
- `proyecto/css/styles.css`: presentación visual y adaptación a pantallas pequeñas.
- `proyecto/js/script.js`: carga el catálogo, filtra coches y crea tarjetas y fichas.
- `server.js`: sirve los archivos y consulta la wiki para el catálogo y las fichas de coches.

## Datos de las fichas

Las páginas de la categoría contienen una plantilla `InfoboxCar`. En las 32 fichas consultadas aparecen los campos `production`, `manufacturer`, `eng`, `disp`, `weight`, `bhp`, `torque`, `accel`, `top speed`, `transmission2` y `transmission`. El cliente lee esa plantilla y presenta esos valores cuando se abre una ficha.

La wiki es comunitaria y no oficial; sus datos pueden cambiar. La página enlaza a la fuente original y no está afiliada a Electronic Arts.
