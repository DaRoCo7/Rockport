const path = require("node:path");
const express = require("express");

const app = express();
const port = process.env.PORT || 3000;
const wikiApi = "https://nfs.fandom.com/api.php";
const games = {
  "most-wanted-2005": {
    label: "Most Wanted (2005)",
    catalogCategory: "Category:Stock (Most Wanted (2005))"
  },
  carbon: {
    label: "Carbon",
    catalogCategory: "Category:Stock (Carbon)"
  },
  "underground-2": {
    label: "Underground 2",
    catalogCategory: "Category:Vehicles (Underground 2)",
    excludedCategories: ["Category:Traffic Vehicles (Underground 2)"]
  }
};

app.use("/css", express.static(path.join(__dirname, "proyecto", "css")));
app.use("/js", express.static(path.join(__dirname, "proyecto", "js")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "proyecto", "html", "index.html"));
});

app.get("/api/cars", async (req, res) => {
  const gameId = typeof req.query.game === "string" ? req.query.game : "most-wanted-2005";
  const game = games[gameId];

  if (!game) {
    return res.status(400).json({ error: "El juego solicitado no está disponible." });
  }

  const catalogParameters = new URLSearchParams({
    action: "query",
    generator: "categorymembers",
    gcmtitle: game.catalogCategory,
    gcmnamespace: "0",
    gcmlimit: "100",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "640",
    format: "json"
  });

  try {
    const excludedCategoryRequests = (game.excludedCategories || []).map((category) =>
      getCategoryMembers(category)
    );
    const [catalogPayload, ...excludedMembers] = await Promise.all([
      fetchWikiJson(catalogParameters),
      ...excludedCategoryRequests
    ]);
    const excludedPageIds = new Set(
      excludedMembers.flatMap((members) => members.map((page) => page.pageid))
    );
    const pages = Object.values(catalogPayload.query?.pages || {})
      .filter((page) => page.ns === 0 && !excludedPageIds.has(page.pageid))
      .map((page) => ({
        id: page.pageid,
        title: page.title,
        image: page.thumbnail?.source || ""
      }))
      .sort((first, second) => first.title.localeCompare(second.title, "es"));

    if (pages.length === 0) {
      console.error(`NFS Wiki returned no cars for game ${gameId}.`);
      return res.status(502).json({
        error: "La wiki no ha devuelto coches para el catálogo."
      });
    }

    return res.json(pages.map((page) => ({ ...page, gameId, gameLabel: game.label })));
  } catch (error) {
    console.error(`Could not load the NFS Wiki catalog for ${gameId}:`, error);
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
  console.log(`Garaje Need for Speed disponible en http://localhost:${port}`);
});

async function fetchWikiJson(parameters) {
  const response = await fetch(`${wikiApi}?${parameters}`);

  if (!response.ok) {
    throw new Error(`NFS Wiki responded with status ${response.status}.`);
  }

  return response.json();
}

async function getCategoryMembers(category) {
  const parameters = new URLSearchParams({
    action: "query",
    list: "categorymembers",
    cmtitle: category,
    cmnamespace: "0",
    cmlimit: "100",
    format: "json"
  });
  const payload = await fetchWikiJson(parameters);
  return payload.query?.categorymembers || [];
}
