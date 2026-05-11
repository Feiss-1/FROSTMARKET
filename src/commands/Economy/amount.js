import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} from 'discord.js';

import { logger } from '../../utils/logger.js';

// ===============================
// EDIT THESE
// ===============================
const OWNER_IDS = ['772345007469756436'];

// Laita Gamblit accountin tiedot tähän.
// Älä lähetä tätä tiedostoa kenellekään, jos tässä on oikea salasana.
const GAMBLIT_USERNAME = 'FROSTMARKET';
const GAMBLIT_PASSWORD = 'Jukkapoika124';

// Nämä pitää vaihtaa sinun Gamblit-sivun oikeisiin osoitteisiin.
const GAMBLIT_LOGIN_URL = 'https://gamblit.net/';
const GAMBLIT_BALANCE_URL = 'https://gamblit.net/';

// Esimerkkejä:
// Jos API palauttaa { "dl": 12345 }, käytä 'dl'
// Jos API palauttaa { "balance": { "dl": 12345 } }, käytä 'balance.dl'
const DL_JSON_PATH = 'dl';

// Päivitysnopeus. 1000 = 1 sekunti.
const UPDATE_INTERVAL_MS = 1000;

// ===============================
// DO NOT EDIT BELOW UNLESS NEEDED
// ===============================

const AMOUNT_CONFIG_KEY = (guildId) => `amount_panel_config_${guildId}`;
const AMOUNT_INTERVAL_FLAG = Symbol.for('frostmarket.amount.intervals');

let sessionCookie = null;
let lastLoginAt = 0;

function isOwner(userId) {
    return OWNER_IDS.includes(userId);
}

function formatDl(amount) {
    const num = Number(amount || 0);
    return `${num.toLocaleString('en-US')} DL`;
}

function getValueByPath(obj, path) {
    if (!path) return undefined;

    return path.split('.').reduce((current, key) => {
        if (current && Object.prototype.hasOwnProperty.call(current, key)) {
            return current[key];
        }

        return undefined;
    }, obj);
}

function parseCookies(response) {
    const raw = response.headers.get('set-cookie');

    if (!raw) return null;

    return raw
        .split(',')
        .map(cookie => cookie.split(';')[0])
        .join('; ');
}

async function saveAmountConfig(client, guildId, config) {
    if (!client.db) return;
    await client.db.set(AMOUNT_CONFIG_KEY(guildId), config);
}

async function getAmountConfig(client, guildId) {
    if (!client.db) return null;
    return await client.db.get(AMOUNT_CONFIG_KEY(guildId));
}

async function loginToGamblit(force = false) {
    const now = Date.now();

    // Älä loggaa sisään uudestaan joka sekunti.
    // Tämä käyttää samaa session cookieta noin 10 minuuttia.
    if (!force && sessionCookie && now - lastLoginAt < 10 * 60 * 1000) {
        return sessionCookie;
    }

    const response = await fetch(GAMBLIT_LOGIN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'FrostMarket-Discord-Bot',
        },
        body: JSON.stringify({
            username: GAMBLIT_USERNAME,
            password: GAMBLIT_PASSWORD,
        }),
    });

    if (!response.ok) {
        throw new Error(`Login failed: ${response.status} ${response.statusText}`);
    }

    const cookie = parseCookies(response);

    if (!cookie) {
        // Jos sinun sivu palauttaa tokenin JSONina, tämä kohta pitää muuttaa.
        // Esim: const data = await response.json(); sessionCookie = `token=${data.token}`;
        throw new Error('Login succeeded, but no session cookie was returned.');
    }

    sessionCookie = cookie;
    lastLoginAt = now;

    return sessionCookie;
}

async function fetchGamblitDlAmount() {
    const cookie = await loginToGamblit(false);

    let response = await fetch(GAMBLIT_BALANCE_URL, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'FrostMarket-Discord-Bot',
            'Cookie': cookie,
        },
    });

    // Jos sessio vanheni, kirjaudutaan uudelleen kerran.
    if (response.status === 401 || response.status === 403) {
        const newCookie = await loginToGamblit(true);

        response = await fetch(GAMBLIT_BALANCE_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'FrostMarket-Discord-Bot',
                'Cookie': newCookie,
            },
        });
    }

    if (!response.ok) {
        throw new Error(`Balance API failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    let value = getValueByPath(data, DL_JSON_PATH);

    if (value === undefined) {
        value =
            data.dl ??
            data.DL ??
            data.amount ??
            data.balance ??
            data.balance?.dl ??
            data.balance?.DL ??
            data.account?.dl ??
            data.account?.DL ??
            data.data?.dl ??
            data.data?.DL ??
            data.data?.balance;
    }

    const amount = Number(value);

    if (Number.isNaN(amount)) {
        throw new Error(`Could not read DL amount. Check DL_JSON_PATH. Current path: ${DL_JSON_PATH}`);
    }

    return amount;
}

function buildAmountEmbed(config, dlAmount, status = 'online', errorMessage = null) {
    const updatedUnix = Math.floor(Date.now() / 1000);

    const embed = new EmbedBuilder()
        .setTitle(config.title || '❄️ FrostMarket Live DL Stock')
        .setColor(status === 'online' ? '#00d5ff' : '#ED4245')
        .setDescription(
            status === 'online'
                ? 'Live DL amount from the connected Gamblit account.'
                : 'Could not update the live DL amount.'
        )
        .addFields(
            {
                name: '💎 DL Left',
                value: status === 'online'
                    ? `\`${formatDl(dlAmount)}\``
                    : '`Offline`',
                inline: true,
            },
            {
                name: '🔄 Update Speed',
                value: '`Every 1 second`',
                inline: true,
            },
            {
                name: '⚡ Status',
                value: status === 'online'
                    ? '`Live`'
                    : '`Login/API Error`',
                inline: true,
            },
            {
                name: '🕒 Last Update',
                value: `<t:${updatedUnix}:R>`,
                inline: true,
            },
            {
                name: '🎮 Source',
                value: '`Gamblit Account`',
                inline: true,
            },
            {
                name: '🔐 Login',
                value: '`Saved inside bot file`',
                inline: true,
            },
        )
        .setFooter({
            text: config.footer || 'FrostMarket • Live DL Tracker',
        })
        .setTimestamp();

    if (errorMessage) {
        embed.addFields({
            name: '⚠️ Error',
            value: `\`${String(errorMessage).slice(0, 900)}\``,
            inline: false,
        });
    }

    if (config.image) {
        embed.setImage(config.image);
    }

    if (config.thumbnail) {
        embed.setThumbnail(config.thumbnail);
    }

    return embed;
}

async function startAmountUpdater(client, guildId) {
    if (!client[AMOUNT_INTERVAL_FLAG]) {
        client[AMOUNT_INTERVAL_FLAG] = new Map();
    }

    const intervals = client[AMOUNT_INTERVAL_FLAG];

    if (intervals.has(guildId)) {
        clearInterval(intervals.get(guildId));
        intervals.delete(guildId);
    }

    const config = await getAmountConfig(client, guildId);

    if (!config) return;

    let lastDlAmount = null;
    let lastEditAt = 0;

    const updateNow = async () => {
        try {
            const channel = await client.channels.fetch(config.channelId).catch(() => null);

            if (!channel || !channel.isTextBased()) {
                throw new Error('Amount panel channel was not found or is not text based.');
            }

            const message = await channel.messages.fetch(config.messageId).catch(() => null);

            if (!message) {
                throw new Error('Amount panel message was not found.');
            }

            const dlAmount = await fetchGamblitDlAmount();

            const now = Date.now();

            // Tämä yrittää päivittää kerran sekunnissa.
            // Jos Discord rate limit tulee vastaan, catch nappaa virheen.
            if (now - lastEditAt >= UPDATE_INTERVAL_MS) {
                const embed = buildAmountEmbed(config, dlAmount, 'online');

                await message.edit({
                    embeds: [embed],
                });

                lastDlAmount = dlAmount;
                lastEditAt = now;
            }
        } catch (error) {
            logger.warn('Amount updater failed:', {
                guildId,
                error: error.message,
            });

            try {
                const latestConfig = await getAmountConfig(client, guildId);
                if (!latestConfig) return;

                const channel = await client.channels.fetch(latestConfig.channelId).catch(() => null);
                if (!channel || !channel.isTextBased()) return;

                const message = await channel.messages.fetch(latestConfig.messageId).catch(() => null);
                if (!message) return;

                const now = Date.now();

                // Error-tilassa ei spämmätä joka sekunti, vaan 5 sek välein.
                if (now - lastEditAt >= 5000) {
                    const embed = buildAmountEmbed(
                        latestConfig,
                        lastDlAmount || 0,
                        'offline',
                        error.message,
                    );

                    await message.edit({
                        embeds: [embed],
                    });

                    lastEditAt = now;
                }
            } catch {}
        }
    };

    await updateNow();

    const interval = setInterval(updateNow, UPDATE_INTERVAL_MS);
    intervals.set(guildId, interval);

    logger.info('✅ Live DL amount updater started', {
        guildId,
        intervalMs: UPDATE_INTERVAL_MS,
    });
}

const amountCommand = {
    data: new SlashCommandBuilder()
        .setName('amount')
        .setDescription('Owner-only live DL amount tracker from Gamblit account.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel where the live amount panel will be sent.')
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName('image')
                .setDescription('Big image URL for the amount embed.')
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('thumbnail')
                .setDescription('Small thumbnail image URL for the amount embed.')
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('title')
                .setDescription('Panel title.')
                .setRequired(false),
        ),

    category: 'owner',

    async execute(interaction, config, client) {
        try {
            if (!isOwner(interaction.user.id)) {
                return await interaction.reply({
                    content: '❌ Only the bot owner can use this command.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const channel = interaction.options.getChannel('channel');
            const image = interaction.options.getString('image');
            const thumbnail = interaction.options.getString('thumbnail');
            const title =
                interaction.options.getString('title') ||
                '❄️ FrostMarket Live DL Stock';

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral,
            });

            const panelConfig = {
                guildId: interaction.guildId,
                channelId: channel.id,
                image: image || null,
                thumbnail: thumbnail || null,
                title,
                footer: `${interaction.guild.name} • Live DL Tracker`,
                createdBy: interaction.user.id,
                updatedAt: new Date().toISOString(),
            };

            let firstDlAmount = 0;
            let firstStatus = 'online';
            let firstError = null;

            try {
                firstDlAmount = await fetchGamblitDlAmount();
            } catch (error) {
                firstStatus = 'offline';
                firstError = error.message;
            }

            const embed = buildAmountEmbed(
                panelConfig,
                firstDlAmount,
                firstStatus,
                firstError,
            );

            const panelMessage = await channel.send({
                embeds: [embed],
            });

            panelConfig.messageId = panelMessage.id;

            await saveAmountConfig(client, interaction.guildId, panelConfig);

            await startAmountUpdater(client, interaction.guildId);

            return await interaction.editReply({
                content:
                    `✅ Live DL amount panel created in ${channel}.\n\n` +
                    `**Update Speed:** every 1 second\n` +
                    `**Login:** saved inside \`amount.js\`\n` +
                    `**Image:** ${image ? 'Added' : 'None'}\n` +
                    `**Thumbnail:** ${thumbnail ? 'Added' : 'None'}\n\n` +
                    `⚠️ Älä näytä tätä tiedostoa kenellekään, koska siinä on Gamblit salasana.`,
            });
        } catch (error) {
            logger.error('Amount command error:', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (interaction.deferred || interaction.replied) {
                return await interaction.editReply({
                    content: '❌ Failed to create live DL amount panel.',
                }).catch(() => {});
            }

            return await interaction.reply({
                content: '❌ Failed to create live DL amount panel.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    },

    async start(client) {
        if (!client?.guilds?.cache) return;

        for (const guild of client.guilds.cache.values()) {
            const config = await getAmountConfig(client, guild.id).catch(() => null);
            if (!config) continue;

            await startAmountUpdater(client, guild.id).catch(error => {
                logger.warn('Failed to restart amount updater:', {
                    guildId: guild.id,
                    error: error.message,
                });
            });
        }
    },
};

export default amountCommand;
