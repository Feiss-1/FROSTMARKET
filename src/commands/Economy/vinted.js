const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const DATA_FILE = path.join(__dirname, "vinted-data.json");

let watcherStarted = false;
let watcherInterval = null;

const DEFAULT_CONFIG = {
  enabled: false,
  channelId: null,

  // Kuinka usein tarkistaa Vintedin. Älä laita liian pieneksi.
  checkIntervalSeconds: 180,

  minPriceEur: 5,
  maxPriceEur: 10,

  brands: [
    "Ralph Lauren",
    "Polo Ralph Lauren",
    "Tommy Hilfiger",
    "Nike",
    "Adidas",
    "Lacoste",
    "The North Face",
    "Carhartt",
    "Calvin Klein"
  ],

  goodConditionWords: [
    "erittäin hyvä",
    "hyvä",
    "uudenveroinen",
    "uusi ilman hintalappua",
    "uusi hintalapulla",
    "very good",
    "good",
    "new without tags",
    "new with tags"
  ],

  badConditionWords: [
    "tyydyttävä",
    "huono",
    "fair",
    "satisfactory"
  ],

  searchUrls: [
    "https://www.vinted.fi/catalog?search_text=ralph%20lauren%20paita&price_to=10",
    "https://www.vinted.fi/catalog?search_text=tommy%20hilfiger%20paita&price_to=10",
    "https://www.vinted.fi/catalog?search_text=nike%20huppari&price_to=10",
    "https://www.vinted.fi/catalog?search_text=lacoste%20paita&price_to=10"
  ],

  seenItems: []
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
      return { ...DEFAULT_CONFIG };
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...data,
      brands: data.brands || DEFAULT_CONFIG.brands,
      searchUrls: data.searchUrls || DEFAULT_CONFIG.searchUrls,
      seenItems: data.seenItems || []
    };
  } catch (err) {
    console.log("[VINTED] Data load error:", err.message);
    return { ...DEFAULT_CONFIG };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.log("[VINTED] Data save error:", err.message);
  }
}

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parsePrice(text) {
  const fixed = String(text || "").replace(/\u00a0/g, " ");

  const patterns = [
    /(\d{1,4}(?:[,.]\d{1,2})?)\s*€/,
    /€\s*(\d{1,4}(?:[,.]\d{1,2})?)/
  ];

  for (const pattern of patterns) {
    const match = fixed.match(pattern);
    if (!match) continue;

    const price = Number(match[1].replace(",", "."));
    if (!Number.isNaN(price)) return price;
  }

  return null;
}

function getBrand(text, brands) {
  const lower = String(text || "").toLowerCase();

  for (const brand of brands) {
    if (lower.includes(String(brand).toLowerCase())) {
      return brand;
    }
  }

  return null;
}

function conditionIsGood(text, goodWords, badWords) {
  const lower = String(text || "").toLowerCase();

  for (const bad of badWords) {
    if (lower.includes(String(bad).toLowerCase())) {
      return false;
    }
  }

  for (const good of goodWords) {
    if (lower.includes(String(good).toLowerCase())) {
      return true;
    }
  }

  // Vinted ei aina näytä kuntoa hakutuloksen HTML:ssä,
  // joten ei hylätä tuotetta pelkästään siksi.
  return true;
}

function getItemId(url) {
  const match = String(url).match(/\/items\/(\d+)/);
  if (match) return match[1];

  return String(url).split("?")[0];
}

async function fetchVintedHtml(url) {
  const response = await axios.get(url, {
    timeout: 25000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8"
    }
  });

  return response.data;
}

function extractItems(html, pageUrl) {
  const $ = cheerio.load(html);
  const found = new Map();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !href.includes("/items/")) return;

    const itemUrl = new URL(href, pageUrl).toString().split("?")[0];
    const id = getItemId(itemUrl);

    let card = $(el);

    for (let i = 0; i < 5; i++) {
      if (card.parent().length) {
        card = card.parent();
      }
    }

    const cardText = cleanText(card.text());
    const linkText = cleanText($(el).text());
    const title = linkText || cardText.slice(0, 120) || "Vinted tuote";
    const price = parsePrice(cardText);

    const img = card.find("img").first();
    const imageUrl = img.attr("src") || img.attr("data-src") || null;

    found.set(id, {
      id,
      title,
      url: itemUrl,
      price,
      text: cardText,
      imageUrl
    });
  });

  return [...found.values()];
}

function itemPassesFilters(item, config) {
  const fullText = `${item.title || ""} ${item.text || ""}`;

  const brand = getBrand(fullText, config.brands);
  if (!brand) return { ok: false };

  if (item.price === null || item.price === undefined) {
    return { ok: false };
  }

  if (item.price < Number(config.minPriceEur)) {
    return { ok: false };
  }

  if (item.price > Number(config.maxPriceEur)) {
    return { ok: false };
  }

  if (!conditionIsGood(fullText, config.goodConditionWords, config.badConditionWords)) {
    return { ok: false };
  }

  return {
    ok: true,
    brand
  };
}

async function sendVintedItem(channel, item, brand) {
  const priceText = `${Number(item.price).toFixed(2).replace(".", ",")} €`;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(item.title.slice(0, 250))
    .setURL(item.url)
    .setDescription(
      `**Merkki:** ${brand}\n` +
      `**Hinta:** ${priceText}\n\n` +
      `Mahdollinen halpa Vinted-löytö. Tarkista koko, kunto, aitous ja myyjän arviot ennen ostoa.`
    )
    .setFooter({ text: "Vinted ilmoitus" })
    .setTimestamp();

  if (item.imageUrl) {
    embed.setThumbnail(item.imageUrl);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Avaa Vintedissä")
      .setStyle(ButtonStyle.Link)
      .setURL(item.url)
  );

  await channel.send({
    embeds: [embed],
    components: [row]
  });
}

async function checkVinted(client) {
  const config = loadData();

  if (!config.enabled || !config.channelId) {
    return;
  }

  const channel = await client.channels.fetch(config.channelId).catch(() => null);

  if (!channel) {
    console.log("[VINTED] Kanavaa ei löytynyt.");
    return;
  }

  const seen = new Set(config.seenItems || []);
  const newSeen = new Set(seen);
  const allItems = new Map();

  for (const searchUrl of config.searchUrls) {
    try {
      const html = await fetchVintedHtml(searchUrl);
      const items = extractItems(html, searchUrl);

      for (const item of items) {
        allItems.set(item.id, item);
      }
    } catch (err) {
      console.log("[VINTED] Haku epäonnistui:", searchUrl);
      console.log("[VINTED]", err.message);
    }
  }

  console.log(`[VINTED] Tarkistus valmis. Tuotteita löytyi: ${allItems.size}`);

  for (const item of allItems.values()) {
    if (seen.has(item.id)) continue;

    newSeen.add(item.id);

    const result = itemPassesFilters(item, config);

    if (!result.ok) continue;

    await sendVintedItem(channel, item, result.brand);
    console.log(`[VINTED] MATCH: ${result.brand} | ${item.price}€ | ${item.title}`);
  }

  config.seenItems = [...newSeen].slice(-5000);
  saveData(config);
}

function startWatcher(client) {
  const config = loadData();

  if (watcherStarted) return;

  watcherStarted = true;

  const intervalSeconds = Math.max(Number(config.checkIntervalSeconds || 180), 60);

  console.log(`[VINTED] Watcher päällä. Väli: ${intervalSeconds}s`);

  setTimeout(() => {
    checkVinted(client).catch((err) => console.log("[VINTED]", err.message));
  }, 5000);

  watcherInterval = setInterval(() => {
    checkVinted(client).catch((err) => console.log("[VINTED]", err.message));
  }, intervalSeconds * 1000);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vinted")
    .setDescription("Käynnistää halpojen Vinted-tuotteiden ilmoitukset tähän kanavaan")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, client) {
    const config = loadData();

    config.enabled = true;
    config.channelId = interaction.channelId;

    saveData(config);

    startWatcher(client);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Vinted ilmoitukset käynnistetty")
      .setDescription("Alat nyt saada halpoja hintoja olevia Vinted tuotteita tähän Discord-kanavaan.")
      .addFields(
        {
          name: "Hintaraja",
          value: `${config.minPriceEur}€ - ${config.maxPriceEur}€`,
          inline: true
        },
        {
          name: "Tarkistusväli",
          value: `${Math.max(Number(config.checkIntervalSeconds || 180), 60)} sekuntia`,
          inline: true
        }
      )
      .setFooter({ text: "Vinted watcher" })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed]
    });

    // Tekee ekan tarkistuksen heti komennon jälkeen.
    setTimeout(() => {
      checkVinted(interaction.client).catch((err) => console.log("[VINTED]", err.message));
    }, 2000);
  },

  // Jos sinun bottisi command handler käyttää run eikä execute:
  async run(client, interaction) {
    return this.execute(interaction, client);
  }
};
