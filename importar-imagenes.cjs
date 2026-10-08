"use strict";

// Uso: node importar-imagenes.cjs [http://localhost:3000]
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");

const games = ["most-wanted-2005", "carbon", "underground-2"];
const root = path.join(__dirname, "proyecto", "assets", "personalizacion");
const concurrency = 2;
const delayMs = 500;
const maxBytes = 20 * 1024 * 1024;
const extensions = ["jpg", "png", "webp", "gif", "avif"];
const report = { startedAt: new Date().toISOString(), downloaded: [], skipped: [], failed: [] };

// Comprueba firmas y límites básicos; no sustituye una decodificación visual.
function imageFormat(bytes) {
  if (bytes.length < 12) throw new Error("Imagen vacía o demasiado corta");
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) return "png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" &&
      bytes.readUInt32LE(4) + 8 === bytes.length) return "webp";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) && bytes.at(-1) === 0x3b) return "gif";
  // AVIF utiliza contenedores ISO BMFF; valida todos los bloques principales.
  if (bytes.toString("ascii", 4, 8) === "ftyp") {
    const firstSize = bytes.readUInt32BE(0);
    let avif = false;
    for (let offset = 8; offset + 4 <= Math.min(firstSize, bytes.length); offset += 4) {
      if (offset !== 12 && ["avif", "avis"].includes(bytes.toString("ascii", offset, offset + 4))) avif = true;
    }
    let offset = 0;
    while (avif && offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error("AVIF truncado");
      let size = bytes.readUInt32BE(offset);
      if (size === 1) {
        if (offset + 16 > bytes.length) throw new Error("AVIF truncado");
        const largeSize = bytes.readBigUInt64BE(offset + 8);
        if (largeSize > BigInt(bytes.length)) throw new Error("AVIF truncado");
        size = Number(largeSize);
        if (size < 16) throw new Error("AVIF inválido");
      } else if (size === 0) size = bytes.length - offset;
      if (size < 8 || offset + size > bytes.length) throw new Error("AVIF truncado");
      offset += size;
    }
    if (avif && offset === bytes.length) return "avif";
  }
  throw new Error("Formato no compatible o archivo incompleto (JPEG, PNG, WebP, GIF o AVIF)");
}

async function readResponse(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error("Respuesta superior a 20 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function localPath(file) {
  return path.relative(__dirname, file).split(path.sep).join("/");
}

async function importCar(car, game) {
  const entry = { game, id: car.id, title: car.title, originalUrl: car.image || null, localPath: null };
  let temporary;
  try {
    // El ID se toma de la API y se valida antes de usarlo como directorio.
    const id = String(car.id ?? "");
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Identificador de API no válido para una ruta local");
    const directory = path.join(root, game, id);
    for (const extension of extensions) {
      const file = path.join(directory, `base.${extension}`);
      try {
        const stat = await fs.stat(file);
        if (stat.size > maxBytes) continue;
        const bytes = await fs.readFile(file);
        if (imageFormat(bytes) === extension) {
          entry.localPath = localPath(file);
          report.skipped.push({ ...entry, reason: "Archivo existente con formato válido" });
          return;
        }
      } catch (error) {
        if (error.code && error.code !== "ENOENT") throw error;
        // Los archivos incompletos no impiden una nueva descarga.
      }
    }
    if (!car.image) {
      report.skipped.push({ ...entry, reason: "La API no proporciona imagen" });
      return;
    }
    const url = new URL(car.image);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Protocolo de imagen no permitido");
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const bytes = await readResponse(response);
    const extension = imageFormat(bytes);
    const file = path.join(directory, `base.${extension}`);
    entry.localPath = localPath(file);
    await fs.mkdir(directory, { recursive: true });
    temporary = `${file}.${process.pid}.part`;
    // Publica el archivo únicamente cuando la descarga está completa.
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    await fs.rename(temporary, file);
    temporary = null;
    report.downloaded.push({ ...entry, format: extension, bytes: bytes.length });
  } catch (error) {
    report.failed.push({ ...entry, error: error.message });
  } finally {
    if (temporary) await fs.rm(temporary, { force: true });
    await pause(delayMs);
  }
}

async function main() {
  const server = new URL(process.argv[2] || "http://localhost:3000");
  if (!["http:", "https:"].includes(server.protocol)) throw new Error("URL del servidor no válida");
  await fs.mkdir(root, { recursive: true });
  for (const game of games) {
    let cars;
    try {
      const endpoint = new URL("/api/cars", server);
      endpoint.searchParams.set("game", game);
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(60000) });
      cars = JSON.parse((await readResponse(response)).toString("utf8"));
      if (!Array.isArray(cars)) throw new Error("El catálogo no es una lista");
    } catch (error) {
      report.failed.push({ game, id: null, originalUrl: null, localPath: null, error: `Catálogo: ${error.message}` });
      await pause(delayMs);
      continue;
    }
    // Dos trabajadores como máximo; cada uno espera entre vehículos.
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
      await pause(worker * delayMs);
      while (cursor < cars.length) {
        const car = cars[cursor++];
        if (!car || typeof car !== "object") {
          report.failed.push({ game, id: null, originalUrl: null, localPath: null, error: "Entrada de catálogo inválida" });
          continue;
        }
        await importCar(car, game);
      }
    }));
    await pause(delayMs);
  }
  report.finishedAt = new Date().toISOString();
  report.totals = Object.fromEntries(["downloaded", "skipped", "failed"].map((key) => [key, report[key].length]));
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const reportFile = path.join(root, `informe-${stamp}.json`);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(`Informe: ${localPath(reportFile)}`);
  console.log(report.totals);
  if (report.failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Importación interrumpida: ${error.message}`);
  process.exitCode = 1;
});
