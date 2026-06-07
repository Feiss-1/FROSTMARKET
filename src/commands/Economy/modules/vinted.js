const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const CONFIG_PATH = path.join(__dirname, "..", "vinted-config.json");
const SEEN_PATH = path.join(__dirname, "..", "vinted-seen.json");

let watcherStarted = false;
let watcherInterval = null;
let activeChannelId = null;

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function clean(text) {
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
    if (match) {
      const price = Number(match[1].replace(",", "."));
      if (!Number.isNaN(price)) return price;
    }
  }

  return null;
}

function findBrand(text, brands) {
  const lower = String(text || "").toLowerCase();
  return brands.find((brand) => lower.includes(String(brand).toLowerCase())) || null;
}

function conditionLooksGood(text, goodWords, badWords) {
  const lower = String(text || "").toLowerCase();

  for (const bad of badWords || []) {
    if (lower.includes(String(bad).toLowerCase())) return false;
  }

  if (!goodWords || goodWords.length === 0) return true;

  for (const good of goodWords) {
    if (lower.includes(String(good).toLowerCase())) return true;
  }

  return true;
}

function getItemId(url) {
  const match = String(url).match(/\/items\/(\d+)/);
  return match ? match[1] : url.split("?")[0];
}

async function fetchVintedPage(url) {
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

    const url = new URL(href, pageUrl).toString().split("?")[0];
    const id = getItemId(url);

    let card = $(el);
    for (let i = 0; i < 4; i++) {
      if (card.parent().length) card = card.parent();
    }

    const text = clean(card.text());
    const linkText = clean($(el).text());
    const price = parsePrice(text);
    const img = card.find("img").first();
    const imageUrl = img.attr("src") || img.attr("data-src") || null;

    found.set(id, {
      id,
      title: linkText || text.slice(0, 120) || "Vinted-tuote",
      url,
      price,
      text,
      imageUrl
    });
  });

  return [...found.values()];
}

function passesFilters(item, config) {
  const text = `${item.title || ""} ${item.text || ""}`;

  const brand = findBrand(text, config.brands || []);
  if (!brand) return { ok: false };

  if (item.price === null || item.price === undefined) return { ok: false };

  const min = Number(config.minPriceEur ?? 0);
  const max = Number(config.maxPriceEur ?? 999999);

  if (item.price < min || item.price > max) return { ok: false };

  const goodCondition = conditionLooksGood(
    text,
    config.goodConditionWords || [],
    config.badConditionWords || []
  );

  if (!goodCondition) return { ok: false };

  return { ok: true, brand };
}

async function sendVintedAlert(channel, item, brand) {
  const price = `${Number(item.price).toFixed(2).replace(".", ",")} €`;

  const embed = new EmbedBuilder()
    .setTitle(item.title.slice(0, 250))
    .setURL(item.url)
    .setColor(0x2ecc71)
    .setDescription(
      `**Merkki:** ${brand}\n` +
      `**Hinta:** ${price}\n\n` +
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

  await channel.send({ embeds: [embed], components: [row] });
}

async function checkVinted(client) {
  const config = loadJson(CONFIG_PATH, {});
  const channelId = activeChannelId || config.discordChannelId;

  if (!channelId) {
    console.log("[VINTED] Kanavaa ei ole asetettu. Käytä /vinted.");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.log("[VINTED] Kanavaa ei löytynyt.");
    return;
  }

  const seen = new Set(loadJson(SEEN_PATH, []));
  const nextSeen = new Set(seen);
  const unique = new Map();

  for (const searchUrl of config.searchUrls || []) {
    try {
      const html = await fetchVintedPage(searchUrl);
      const items = extractItems(html, searchUrl);
      for (const item of items) unique.set(item.id, item);
    } catch (err) {
      console.log(`[VINTED] Haku epäonnistui: ${searchUrl}`);
      console.log(`[VINTED] ${err.message}`);
    }
  }

  console.log(`[VINTED] Tarkistettu. Tuotteita löytyi: ${unique.size}`);

  for (const item of unique.values()) {
    if (seen.has(item.id)) continue;

    nextSeen.add(item.id);

    const result = passesFilters(item, config);
    if (!result.ok) continue;

    await sendVintedAlert(channel, item, result.brand);
    console.log(`[VINTED] MATCH: ${result.brand} | ${item.price}€ | ${item.title}`);
  }

  saveJson(SEEN_PATH, [...nextSeen].slice(-5000));
}

function startVintedWatcher(client, channelId) {
  const config = loadJson(CONFIG_PATH, {});
  const intervalSeconds = Math.max(Number(config.checkIntervalSeconds || 180), 60);

  activeChannelId = channelId;

  // Tallennetaan kanava configiin, jotta restartin jälkeenkin toimii.
  config.discordChannelId = channelId;
  saveJson(CONFIG_PATH, config);

  if (watcherStarted) {
    return {
      alreadyStarted: true,
      intervalSeconds
    };
  }

  watcherStarted = true;

  setTimeout(() => {
    checkVinted(client).catch((err) => console.log("[VINTED]", err.message));
  }, 5000);

  watcherInterval = setInterval(() => {
    checkVinted(client).catch((err) => console.log("[VINTED]", err.message));
  }, intervalSeconds * 1000);

  console.log(`[VINTED] Käynnistetty kanavalle ${channelId}. Väli ${intervalSeconds}s.`);

  return {
    alreadyStarted: false,
    intervalSeconds
  };
}

async function handleVintedCommand(interaction, client) {
  const result = startVintedWatcher(client, interaction.channelId);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Vinted ilmoitukset käynnistetty")
    .setDescription(
      result.alreadyStarted
        ? "Saat jo halpoja hintoja olevia Vinted tuotteita tähän Discord-kanavaan."
        : "Alat nyt saada halpoja hintoja olevia Vinted tuotteita tähän Discord-kanavaan."
    )
    .addFields({
      name: "Tarkistusväli",
      value: `${result.intervalSeconds} sekuntia`,
      inline: true
    })
    .setFooter({ text: "Vinted watcher" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

module.exports = {
  startVintedWatcher,
  checkVinted,
  handleVintedCommand
};
