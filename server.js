const path = require("node:path");
const express = require("express");

const app = express();
const port = process.env.PORT || 3000;
const wikiApi = "https://nfs.fandom.com/api.php";
const playableCarsCategory = "Category:Stock (Most Wanted (2005))";

app.use("/css", express.static(path.join(__dirname, "proyecto", "css")));
app.use("/js", express.static(path.join(__dirname, "proyecto", "js")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "proyecto", "html", "index.html"));
});

app.get("/api/cars", async (_req, res) => {
  const parameters = new URLSearchParams({
    action: "query",
    generator: "categorymembers",
    gcmtitle: playableCarsCategory,
    gcmlimit: "100",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "640",
    format: "json"
  });

  try {
    const response = await fetch(`${wikiApi}?${parameters}`);

    if (!response.ok) {
      console.error(`NFS Wiki catalog request failed with status ${response.status}.`);
      return res.status(502).json({
        error: "No se pudo cargar el catálogo de coches de la wiki."
      });
    }

    const payload = await response.json();
    const pages = Object.values(payload.query?.pages || {})
      .filter((page) => page.ns === 0)
      .map((page) => ({
        id: page.pageid,
        title: page.title,
        image: page.thumbnail?.source || ""
      }))
      .sort((first, second) => first.title.localeCompare(second.title, "es"));

    if (pages.length === 0) {
      console.error("NFS Wiki returned no playable cars for the configured category.");
      return res.status(502).json({
        error: "La wiki no ha devuelto coches para el catálogo."
      });
    }

    return res.json(pages);
  } catch (error) {
    console.error("Could not load the NFS Wiki catalog:", error);
    return res.status(502).json({
      error: "No se pudo conectar con la wiki de Need for Speed."
    });
  }
});

app.get("/api/cars/:pageId", async (req, res) => {
  if (!/^\d+$/.test(req.params.pageId)) {
    return res.status(400).json({ error: "El identificador del coche no es válido." });
  }

  const parameters = new URLSearchParams({
    action: "parse",
    pageid: req.params.pageId,
    prop: "wikitext",
    format: "json"
  });

  try {
    const response = await fetch(`${wikiApi}?${parameters}`);

    if (!response.ok) {
      console.error(`NFS Wiki car request failed with status ${response.status}.`);
      return res.status(502).json({
        error: "No se pudo cargar la ficha de este coche."
      });
    }

    const payload = await response.json();
    const carPage = payload.parse;
    const wikitext = carPage?.wikitext?.["*"];

    if (!carPage || typeof wikitext !== "string") {
      return res.status(404).json({
        error: "No se encontró la ficha de este coche en la wiki."
      });
    }

    return res.json({
      title: carPage.title,
      wikitext,
      source: `https://nfs.fandom.com/wiki/${encodeURIComponent(carPage.title.replaceAll(" ", "_"))}`
    });
  } catch (error) {
    console.error("Could not load the NFS Wiki car page:", error);
    return res.status(502).json({
      error: "No se pudo conectar con la ficha del coche."
    });
  }
});

app.listen(port, () => {
  console.log(`Página fan disponible en http://localhost:${port}`);
});
