import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} from 'discord.js';

import { logger } from '../../utils/logger.js';

const OWNER_IDS = ['772345007469756436'];

const AMOUNT_CONFIG_KEY = (guildId) => `amount_panel_config_${guildId}`;
const AMOUNT_INTERVAL_FLAG = Symbol.for('frostmarket.amount.intervals');

function isOwner(userId) {
    return OWNER_IDS.includes(userId);
}

function formatBgl(amount) {
    const num = Number(amount || 0);
    return `${num.toLocaleString('en-US')} BGL`;
}

function getValueByPath(obj, path) {
    if (!path) return undefined;

    return path
        .split('.')
        .reduce((current, key) => {
            if (current && Object.prototype.hasOwnProperty.call(current, key)) {
                return current[key];
            }
            return undefined;
        }, obj);
}

async function saveAmountConfig(client, guildId, config) {
    if (!client.db) return;
    await client.db.set(AMOUNT_CONFIG_KEY(guildId), config);
}

async function getAmountConfig(client, guildId) {
    if (!client.db) return null;
    return await client.db.get(AMOUNT_CONFIG_KEY(guildId));
}

async function fetchGamblitBalance(config) {
    const headers = {
        'Accept': 'application/json',
        'User-Agent': 'FrostMarket-Discord-Bot',
    };

    if (config.token) {
        headers.Authorization = `Bearer ${config.token}`;
    }

    const response = await fetch(config.apiUrl, {
        method: 'GET',
        headers,
    });

    if (!response.ok) {
        throw new Error(`API returned ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    const path = config.jsonPath || 'bgl';

    let value = getValueByPath(data, path);

    if (value === undefined) {
        value =
            data.bgl ??
            data.amount ??
            data.balance ??
            data.balance?.bgl ??
            data.account?.bgl ??
            data.data?.bgl ??
            data.data?.balance;
    }

    const numberValue = Number(value);

    if (Number.isNaN(numberValue)) {
        throw new Error(`Could not read BGL amount from API. Check json_path. Current path: ${path}`);
    }

    return numberValue;
}

function buildAmountEmbed(config, amount, status = 'online', errorMessage = null) {
    const updatedUnix = Math.floor(Date.now() / 1000);

    const embed = new EmbedBuilder()
        .setTitle(config.title || '❄️ FrostMarket BGL Stock')
        .setColor(status === 'online' ? '#00d5ff' : '#ED4245')
        .setDescription(
            status === 'online'
                ? 'Live BGL amount from the connected Gamblit account.'
                : 'Could not update live BGL amount.'
        )
        .addFields(
            {
                name: '💎 BGL Left',
                value: status === 'online'
                    ? `\`${formatBgl(amount)}\``
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
                    : '`API Error`',
                inline: true,
            },
            {
                name: '🕒 Last Update',
                value: `<t:${updatedUnix}:R>`,
                inline: true,
            },
            {
                name: '🔗 Source',
                value: '`Gamblit Account API`',
                inline: true,
            },
            {
                name: '🛡️ Security',
                value: '`Token hidden`',
                inline: true,
            },
        )
        .setFooter({
            text: config.footer || 'FrostMarket • Live Amount Tracker',
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

    let lastAmount = null;
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

            const amount = await fetchGamblitBalance(config);

            const now = Date.now();

            const changed = amount !== lastAmount;
            const enoughTimePassed = now - lastEditAt >= 1000;

            if (changed && enoughTimePassed) {
                const embed = buildAmountEmbed(config, amount, 'online');

                await message.edit({
                    embeds: [embed],
                });

                lastAmount = amount;
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

                if (now - lastEditAt >= 5000) {
                    const embed = buildAmountEmbed(latestConfig, lastAmount || 0, 'offline', error.message);

                    await message.edit({
                        embeds: [embed],
                    });

                    lastEditAt = now;
                }
            } catch {}
        }
    };

    await updateNow();

    const interval = setInterval(updateNow, 1000);
    intervals.set(guildId, interval);

    logger.info('✅ Amount live updater started', {
        guildId,
        intervalMs: 1000,
    });
}

const amountCommand = {
    data: new SlashCommandBuilder()
        .setName('amount')
        .setDescription('Owner-only live BGL amount tracker from Gamblit account API.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel where the live amount panel will be sent.')
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName('api_url')
                .setDescription('Gamblit API URL that returns your BGL amount as JSON.')
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName('json_path')
                .setDescription('Where the BGL amount is in JSON. Example: bgl or balance.bgl')
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('token')
                .setDescription('Optional API token. Do not use your account password.')
                .setRequired(false),
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
            const apiUrl = interaction.options.getString('api_url');
            const jsonPath = interaction.options.getString('json_path') || 'bgl';
            const token = interaction.options.getString('token');
            const image = interaction.options.getString('image');
            const thumbnail = interaction.options.getString('thumbnail');
            const title = interaction.options.getString('title') || '❄️ FrostMarket BGL Stock';

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral,
            });

            const panelConfig = {
                guildId: interaction.guildId,
                channelId: channel.id,
                apiUrl,
                jsonPath,
                token: token || null,
                image: image || null,
                thumbnail: thumbnail || null,
                title,
                footer: `${interaction.guild.name} • Live Amount Tracker`,
                createdBy: interaction.user.id,
                updatedAt: new Date().toISOString(),
            };

            let firstAmount = 0;
            let firstStatus = 'online';
            let firstError = null;

            try {
                firstAmount = await fetchGamblitBalance(panelConfig);
            } catch (error) {
                firstStatus = 'offline';
                firstError = error.message;
            }

            const embed = buildAmountEmbed(panelConfig, firstAmount, firstStatus, firstError);

            const panelMessage = await channel.send({
                embeds: [embed],
            });

            panelConfig.messageId = panelMessage.id;

            await saveAmountConfig(client, interaction.guildId, panelConfig);

            await startAmountUpdater(client, interaction.guildId);

            return await interaction.editReply({
                content:
                    `✅ Live BGL amount panel created in ${channel}.\n\n` +
                    `**API URL:** saved\n` +
                    `**JSON Path:** \`${jsonPath}\`\n` +
                    `**Update Speed:** every 1 second\n` +
                    `**Image:** ${image ? 'Added' : 'None'}\n` +
                    `**Thumbnail:** ${thumbnail ? 'Added' : 'None'}\n\n` +
                    `⚠️ Do not put your Gamblit password in the bot. Use an API token only.`,
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
                    content: '❌ Failed to create live amount panel.',
                }).catch(() => {});
            }

            return await interaction.reply({
                content: '❌ Failed to create live amount panel.',
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
