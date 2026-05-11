import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} from 'discord.js';

import { logger } from '../../utils/logger.js';

const OWNER_IDS = ['772345007469756436'];

const AMOUNT_CONFIG_KEY = (guildId) => `amount_stock_config_${guildId}`;

function isOwner(userId) {
    return OWNER_IDS.includes(userId);
}

function formatBgl(amount) {
    return `${Number(amount || 0).toFixed(2)} BGL`;
}

function formatDlFromBgl(amount) {
    return `${Number((amount || 0) * 100).toLocaleString('en-US')} DL`;
}

async function getStockConfig(client, guildId) {
    if (!client.db) return null;
    return await client.db.get(AMOUNT_CONFIG_KEY(guildId));
}

async function saveStockConfig(client, guildId, config) {
    if (!client.db) return;
    await client.db.set(AMOUNT_CONFIG_KEY(guildId), config);
}

function buildStockEmbed(config, guild) {
    const amount = Number(config.amount || 0);
    const updatedUnix = Math.floor(Date.now() / 1000);

    const guildName = guild?.name || config.guildName || 'FrostMarket';
    const guildIcon = guild?.iconURL?.({ dynamic: true }) || undefined;

    const embed = new EmbedBuilder()
        .setTitle(config.title || '💎 LIVE STOCK')
        .setColor(config.color || '#00d5ff')
        .setDescription(
            config.description ||
            'Current BGL stock available for delivery.'
        )
        .addFields(
            {
                name: '💎 BGL Stock',
                value: `\`${formatBgl(amount)}\``,
                inline: true,
            },
            {
                name: '💰 DL Value',
                value: `\`${formatDlFromBgl(amount)}\``,
                inline: true,
            },
            {
                name: '⚡ Status',
                value: amount > 0 ? '`In Stock`' : '`Out of Stock`',
                inline: true,
            },
            {
                name: '🔄 Updated',
                value: `<t:${updatedUnix}:R>`,
                inline: true,
            },
            {
                name: '📦 Update Method',
                value: '`Auto-updated after each delivery`',
                inline: true,
            },
            {
                name: '🛒 Shop',
                value: `\`${guildName}\``,
                inline: true,
            },
        )
        .setFooter({
            text: `${guildName} • Auto-updated after each delivery`,
            iconURL: guildIcon,
        })
        .setTimestamp();

    if (config.image) {
        embed.setImage(config.image);
    }

    if (config.thumbnail) {
        embed.setThumbnail(config.thumbnail);
    }

    return embed;
}

async function updateStockMessage(client, guild, config) {
    const channel = await client.channels.fetch(config.channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        throw new Error('Stock channel not found or is not text based.');
    }

    const message = await channel.messages.fetch(config.messageId).catch(() => null);

    if (!message) {
        throw new Error('Stock message not found. Run /amount setup again.');
    }

    const embed = buildStockEmbed(config, guild);

    await message.edit({
        embeds: [embed],
    });

    return message;
}

const amountCommand = {
    data: new SlashCommandBuilder()
        .setName('amount')
        .setDescription('Manage live BGL stock amount.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Create the live BGL stock panel.')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel where the stock panel will be sent.')
                        .setRequired(true),
                )
                .addNumberOption(option =>
                    option
                        .setName('amount')
                        .setDescription('Starting BGL amount. Example: 532.70')
                        .setRequired(true),
                )
                .addStringOption(option =>
                    option
                        .setName('image')
                        .setDescription('Big image URL for the stock embed.')
                        .setRequired(false),
                )
                .addStringOption(option =>
                    option
                        .setName('thumbnail')
                        .setDescription('Small thumbnail URL for the stock embed.')
                        .setRequired(false),
                )
                .addStringOption(option =>
                    option
                        .setName('title')
                        .setDescription('Embed title. Default: LIVE STOCK')
                        .setRequired(false),
                )
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Embed description.')
                        .setRequired(false),
                ),
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the exact BGL stock amount.')
                .addNumberOption(option =>
                    option
                        .setName('amount')
                        .setDescription('New exact BGL amount.')
                        .setRequired(true),
                ),
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add BGL to the current stock.')
                .addNumberOption(option =>
                    option
                        .setName('amount')
                        .setDescription('Amount of BGL to add.')
                        .setRequired(true),
                ),
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove BGL from the current stock after delivery.')
                .addNumberOption(option =>
                    option
                        .setName('amount')
                        .setDescription('Amount of BGL to remove.')
                        .setRequired(true),
                ),
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('show')
                .setDescription('Show the current saved BGL stock.'),
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

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'setup') {
                const channel = interaction.options.getChannel('channel');
                const amount = interaction.options.getNumber('amount');
                const image = interaction.options.getString('image');
                const thumbnail = interaction.options.getString('thumbnail');
                const title = interaction.options.getString('title') || '💎 LIVE STOCK';
                const description =
                    interaction.options.getString('description') ||
                    'Current BGL stock available for delivery.';

                const stockConfig = {
                    guildId: interaction.guildId,
                    guildName: interaction.guild.name,
                    channelId: channel.id,
                    amount: Number(amount || 0),
                    image: image || null,
                    thumbnail: thumbnail || null,
                    title,
                    description,
                    color: '#00d5ff',
                    createdBy: interaction.user.id,
                    updatedBy: interaction.user.id,
                    updatedAt: new Date().toISOString(),
                };

                const embed = buildStockEmbed(stockConfig, interaction.guild);

                const message = await channel.send({
                    embeds: [embed],
                });

                stockConfig.messageId = message.id;

                await saveStockConfig(client, interaction.guildId, stockConfig);

                return await interaction.reply({
                    content:
                        `✅ Live stock panel created in ${channel}.\n\n` +
                        `**Current Stock:** ${formatBgl(stockConfig.amount)}\n` +
                        `**DL Value:** ${formatDlFromBgl(stockConfig.amount)}`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            const stockConfig = await getStockConfig(client, interaction.guildId);

            if (!stockConfig) {
                return await interaction.reply({
                    content: '❌ Stock panel is not set up yet. Use `/amount setup` first.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (subcommand === 'show') {
                return await interaction.reply({
                    content:
                        `💎 **Current Stock:** ${formatBgl(stockConfig.amount)}\n` +
                        `💰 **DL Value:** ${formatDlFromBgl(stockConfig.amount)}`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            const amount = interaction.options.getNumber('amount');

            if (amount < 0) {
                return await interaction.reply({
                    content: '❌ Amount cannot be negative.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const oldAmount = Number(stockConfig.amount || 0);

            if (subcommand === 'set') {
                stockConfig.amount = Number(amount);
            }

            if (subcommand === 'add') {
                stockConfig.amount = oldAmount + Number(amount);
            }

            if (subcommand === 'remove') {
                stockConfig.amount = Math.max(0, oldAmount - Number(amount));
            }

            stockConfig.updatedBy = interaction.user.id;
            stockConfig.updatedAt = new Date().toISOString();

            await saveStockConfig(client, interaction.guildId, stockConfig);
            await updateStockMessage(client, interaction.guild, stockConfig);

            let actionText = 'updated';

            if (subcommand === 'set') actionText = `set to ${formatBgl(stockConfig.amount)}`;
            if (subcommand === 'add') actionText = `increased by ${formatBgl(amount)}`;
            if (subcommand === 'remove') actionText = `decreased by ${formatBgl(amount)}`;

            return await interaction.reply({
                content:
                    `✅ Stock ${actionText}.\n\n` +
                    `**Old Stock:** ${formatBgl(oldAmount)}\n` +
                    `**New Stock:** ${formatBgl(stockConfig.amount)}\n` +
                    `**DL Value:** ${formatDlFromBgl(stockConfig.amount)}`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('Amount command error:', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user?.id,
                guildId: interaction.guildId,
            });

            if (interaction.replied || interaction.deferred) {
                return await interaction.editReply({
                    content: '❌ Failed to update stock amount.',
                }).catch(() => {});
            }

            return await interaction.reply({
                content: '❌ Failed to update stock amount.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    },
};

export default amountCommand;
