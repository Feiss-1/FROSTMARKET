import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
} from 'discord.js';

import { logger } from '../../utils/logger.js';

const OWNER_IDS = ['772345007469756436'];

const FNACC_LISTENER_FLAG = Symbol.for('frostmarket.fnacc.listener');

const FNACC_CONFIG_KEY = (guildId) => `fnacc_shop_config_${guildId}`;
const FNACC_USER_KEY = (guildId, userId) => `fnacc_shop_user_${guildId}_${userId}`;
const FNACC_SELECTED_KEY = (guildId, userId) => `fnacc_selected_${guildId}_${userId}`;

const FN_ACCOUNTS = [
    {
        id: 'fnacc_001',
        name: 'Stacked OG Account',
        price: 25.00,
        rarity: 'OG',
        skins: 85,
        vbucks: 0,
        level: 210,
        platform: 'Epic Games',
        emailChangeable: true,
        fa2: true,
        description: 'OG-style account with rare cosmetics and good locker value.',
        items: [
            'Renegade-style cosmetics',
            'Rare pickaxes',
            'Battle Pass skins',
            'Emotes',
            'Back blings',
        ],
        image: null,
    },
    {
        id: 'fnacc_002',
        name: 'Budget Starter Account',
        price: 5.00,
        rarity: 'Basic',
        skins: 12,
        vbucks: 0,
        level: 45,
        platform: 'Epic Games',
        emailChangeable: true,
        fa2: false,
        description: 'Cheap Fortnite account for starting out.',
        items: [
            'Starter skins',
            'Basic emotes',
            'Some pickaxes',
        ],
        image: null,
    },
    {
        id: 'fnacc_003',
        name: 'Premium Main Account',
        price: 50.00,
        rarity: 'Premium',
        skins: 150,
        vbucks: 1000,
        level: 300,
        platform: 'Epic Games',
        emailChangeable: true,
        fa2: true,
        description: 'High value Fortnite account with many cosmetics.',
        items: [
            '150 skins',
            'Rare emotes',
            'Rare pickaxes',
            'Battle Pass cosmetics',
            '1000 V-Bucks',
        ],
        image: null,
    },
];

function isOwner(userId) {
    return OWNER_IDS.includes(userId);
}

function formatMoney(amount) {
    return `${Number(amount || 0).toFixed(2)}€`;
}

function getSortedAccounts() {
    return [...FN_ACCOUNTS].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
}

function getAccountById(accountId) {
    return FN_ACCOUNTS.find(acc => acc.id === accountId) || null;
}

function buildPaypalUrl(baseUrl, amount) {
    const cleanBase = String(baseUrl || '').trim();

    if (!cleanBase) return null;

    if (cleanBase.includes('paypal.me')) {
        return `${cleanBase.replace(/\/$/, '')}/${Number(amount || 0).toFixed(2)}`;
    }

    return cleanBase;
}

async function getUserData(client, guildId, userId) {
    const defaultData = {
        boughtAccounts: 0,
        totalSpent: 0,
        lastSelected: null,
        createdAt: new Date().toISOString(),
    };

    if (!client.db) return defaultData;

    const data = await client.db.get(FNACC_USER_KEY(guildId, userId));
    return data || defaultData;
}

async function saveUserData(client, guildId, userId, data) {
    if (!client.db) return;
    await client.db.set(FNACC_USER_KEY(guildId, userId), data);
}

async function getShopConfig(client, guildId) {
    if (!client.db) return null;
    return await client.db.get(FNACC_CONFIG_KEY(guildId));
}

async function saveShopConfig(client, guildId, config) {
    if (!client.db) return;
    await client.db.set(FNACC_CONFIG_KEY(guildId), config);
}

async function setSelectedAccount(client, guildId, userId, accountId) {
    if (!client.db) return;
    await client.db.set(FNACC_SELECTED_KEY(guildId, userId), accountId);
}

async function getSelectedAccount(client, guildId, userId) {
    if (!client.db) return null;
    return await client.db.get(FNACC_SELECTED_KEY(guildId, userId));
}

function ensureFnaccListener(client) {
    if (!client || client[FNACC_LISTENER_FLAG]) return;

    client[FNACC_LISTENER_FLAG] = true;

    client.on('interactionCreate', async (interaction) => {
        try {
            if (
                !interaction.isButton() &&
                !interaction.isStringSelectMenu()
            ) {
                return;
            }

            const customId = interaction.customId || '';
            if (!customId.startsWith('fnacc_')) return;

            await fnaccCommand.handleInteraction(interaction, client);
        } catch (error) {
            logger.error('FNACC auto listener error:', {
                error: error.message,
                stack: error.stack,
                customId: interaction.customId,
                userId: interaction.user?.id,
                guildId: interaction.guildId,
            });

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ FN account shop error.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
        }
    });

    logger.info('✅ FNACC interaction listener registered automatically');
}

function buildShopEmbed(config, guild) {
    const accounts = getSortedAccounts();
    const cheapest = accounts[0];
    const mostExpensive = accounts[accounts.length - 1];

    const guildName = guild?.name || config.shopName || 'FrostMarket';
    const guildIcon = guild?.iconURL?.({ dynamic: true }) || undefined;

    const embed = new EmbedBuilder()
        .setTitle(config.title || '🎮 FORTNITE ACCOUNT SHOP')
        .setDescription(
            config.description ||
            'Choose a Fortnite account from the menu below, view its details, and buy safely through PayPal.'
        )
        .setColor(config.color || '#00d5ff')
        .addFields(
            {
                name: '💰 Price Range',
                value: cheapest && mostExpensive
                    ? `From \`${formatMoney(cheapest.price)}\` to \`${formatMoney(mostExpensive.price)}\``
                    : 'No accounts listed',
                inline: true,
            },
            {
                name: '📦 Accounts Available',
                value: `\`${accounts.length}\` accounts currently for sale`,
                inline: true,
            },
            {
                name: '⚡ Delivery',
                value: config.delivery || 'Manual delivery after payment confirmation',
                inline: true,
            },
            {
                name: '💳 Payment',
                value: 'PayPal',
                inline: true,
            },
            {
                name: '🎯 Selection',
                value: 'Use the dropdown menu to select an account.',
                inline: true,
            },
            {
                name: '🔄 Live Info',
                value: 'Account list, selected account and stats update live.',
                inline: true,
            },
        )
        .setFooter({
            text: `${guildName} • Fortnite Accounts`,
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

function buildAccountEmbed(account, config, user = null) {
    const embed = new EmbedBuilder()
        .setTitle(`🎮 ${account.name}`)
        .setColor('#5865F2')
        .setDescription(account.description || 'Fortnite account details.')
        .addFields(
            {
                name: '💰 Price',
                value: `**${formatMoney(account.price)}**`,
                inline: true,
            },
            {
                name: '⭐ Rarity',
                value: `**${account.rarity || 'Unknown'}**`,
                inline: true,
            },
            {
                name: '👕 Skins',
                value: `**${account.skins || 0}**`,
                inline: true,
            },
            {
                name: '💸 V-Bucks',
                value: `**${account.vbucks || 0}**`,
                inline: true,
            },
            {
                name: '📈 Level',
                value: `**${account.level || 'Unknown'}**`,
                inline: true,
            },
            {
                name: '🖥️ Platform',
                value: `**${account.platform || 'Epic Games'}**`,
                inline: true,
            },
            {
                name: '📧 Email Changeable',
                value: account.emailChangeable ? '✅ Yes' : '❌ No',
                inline: true,
            },
            {
                name: '🔐 2FA',
                value: account.fa2 ? '✅ Enabled / Available' : '❌ Not enabled',
                inline: true,
            },
            {
                name: '🎒 Included Items',
                value: account.items?.length
                    ? account.items.map(item => `• ${item}`).join('\n')
                    : 'No item list added.',
                inline: false,
            },
        )
        .setFooter({
            text: `${config.shopName || 'FrostMarket'} • Selected Fortnite Account`,
            iconURL: user?.displayAvatarURL?.({ dynamic: true }) || undefined,
        })
        .setTimestamp();

    if (account.image) {
        embed.setImage(account.image);
    } else if (config.image) {
        embed.setImage(config.image);
    }

    if (config.thumbnail) {
        embed.setThumbnail(config.thumbnail);
    }

    return embed;
}

function buildMyAccountEmbed(config, userData, user) {
    return new EmbedBuilder()
        .setTitle(`👤 ${user.username}'s FN Account Stats`)
        .setColor('#00d5ff')
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            {
                name: '🎮 Bought Accounts',
                value: `**${Number(userData.boughtAccounts || 0)}**`,
                inline: true,
            },
            {
                name: '💸 Total Spent',
                value: `**${formatMoney(userData.totalSpent)}**`,
                inline: true,
            },
            {
                name: '🛒 Last Selected',
                value: userData.lastSelected
                    ? `\`${userData.lastSelected}\``
                    : 'None selected yet.',
                inline: false,
            },
            {
                name: '📦 Shop',
                value: config.shopName || 'FrostMarket',
                inline: true,
            },
            {
                name: '💳 Payment',
                value: 'PayPal',
                inline: true,
            },
        )
        .setFooter({
            text: `${config.shopName || 'FrostMarket'} • FN Account Member`,
        })
        .setTimestamp();
}

function buildAccountSelectMenu(selectedId = null) {
    const accounts = getSortedAccounts().slice(0, 25);

    const menu = new StringSelectMenuBuilder()
        .setCustomId('fnacc_select')
        .setPlaceholder('Select a Fortnite account');

    for (const account of accounts) {
        menu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`${formatMoney(account.price)} • ${account.name}`.slice(0, 100))
                .setDescription(`${account.skins || 0} skins • ${account.rarity || 'Unknown'} • ${account.platform || 'Epic Games'}`.slice(0, 100))
                .setValue(account.id)
                .setEmoji('🎮')
                .setDefault(selectedId === account.id),
        );
    }

    return new ActionRowBuilder().addComponents(menu);
}

function buildButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('fnacc_view_account')
            .setLabel('Account')
            .setEmoji('🎮')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('fnacc_buy_account')
            .setLabel('Buy Account')
            .setEmoji('💳')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('fnacc_my_account')
            .setLabel('My Account')
            .setEmoji('👤')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('fnacc_refresh')
            .setLabel('Refresh')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary),
    );
}

const fnaccCommand = {
    data: new SlashCommandBuilder()
        .setName('fnacc')
        .setDescription('Owner-only Fortnite account shop panel setup.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel where the Fortnite account shop panel will be sent.')
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName('paypal')
                .setDescription('PayPal.me URL. Example: https://paypal.me/yourname')
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName('image')
                .setDescription('Big image URL for the shop embed.')
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('thumbnail')
                .setDescription('Small thumbnail image URL for the shop embed.')
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('title')
                .setDescription('Shop panel title.')
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('description')
                .setDescription('Shop panel description.')
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('delivery')
                .setDescription('Delivery text.')
                .setRequired(false),
        ),

    category: 'owner',

    async execute(interaction, config, client) {
        try {
            ensureFnaccListener(client);

            if (!isOwner(interaction.user.id)) {
                return await interaction.reply({
                    content: '❌ Only the bot owner can use this command.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const channel = interaction.options.getChannel('channel');
            const paypal = interaction.options.getString('paypal');
            const image = interaction.options.getString('image');
            const thumbnail = interaction.options.getString('thumbnail');
            const title = interaction.options.getString('title') || '🎮 FORTNITE ACCOUNT SHOP';
            const description =
                interaction.options.getString('description') ||
                'Choose a Fortnite account from the menu below, view its details, and buy safely through PayPal.';
            const delivery =
                interaction.options.getString('delivery') ||
                'Manual delivery after payment confirmation';

            const shopConfig = {
                guildId: interaction.guildId,
                guildName: interaction.guild.name,
                channelId: channel.id,
                paypal,
                image: image || null,
                thumbnail: thumbnail || null,
                title,
                description,
                delivery,
                color: '#00d5ff',
                shopName: interaction.guild.name,
                createdBy: interaction.user.id,
                updatedAt: new Date().toISOString(),
            };

            const embed = buildShopEmbed(shopConfig, interaction.guild);

            const message = await channel.send({
                embeds: [embed],
                components: [
                    buildAccountSelectMenu(),
                    buildButtons(),
                ],
            });

            shopConfig.messageId = message.id;

            await saveShopConfig(client, interaction.guildId, shopConfig);

            return await interaction.reply({
                content:
                    `✅ Fortnite account shop panel created in ${channel}.\n\n` +
                    `**Accounts listed:** ${FN_ACCOUNTS.length}\n` +
                    `**PayPal:** ${paypal}\n` +
                    `**Image:** ${image ? 'Added' : 'None'}\n` +
                    `**Thumbnail:** ${thumbnail ? 'Added' : 'None'}\n\n` +
                    `✅ Buttons and dropdown are active automatically.`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('FNACC command error:', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (interaction.replied || interaction.deferred) {
                return await interaction.editReply({
                    content: '❌ Failed to create Fortnite account shop panel.',
                }).catch(() => {});
            }

            return await interaction.reply({
                content: '❌ Failed to create Fortnite account shop panel.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    },

    async handleInteraction(interaction, client) {
        try {
            const customId = interaction.customId || '';

            if (!customId.startsWith('fnacc_')) {
                return false;
            }

            const guildId = interaction.guildId;

            if (!guildId) {
                await interaction.reply({
                    content: '❌ This can only be used inside the server.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                return true;
            }

            const config = await getShopConfig(client, guildId);

            if (!config) {
                await interaction.reply({
                    content: '❌ FN account shop is not configured. Use `/fnacc` first.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                return true;
            }

            if (interaction.isStringSelectMenu()) {
                if (customId === 'fnacc_select') {
                    const selectedId = interaction.values[0];
                    const account = getAccountById(selectedId);

                    if (!account) {
                        await interaction.reply({
                            content: '❌ Account not found.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    await setSelectedAccount(client, guildId, interaction.user.id, selectedId);

                    const userData = await getUserData(client, guildId, interaction.user.id);
                    userData.lastSelected = account.name;
                    await saveUserData(client, guildId, interaction.user.id, userData);

                    await interaction.reply({
                        content:
                            `✅ Selected account: **${account.name}**\n` +
                            `Price: **${formatMoney(account.price)}**\n\n` +
                            `Press **Account** to view details or **Buy Account** to get the PayPal payment link.`,
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }
            }

            if (interaction.isButton()) {
                if (customId === 'fnacc_refresh') {
                    const embed = buildShopEmbed(config, interaction.guild);

                    await interaction.update({
                        embeds: [embed],
                        components: [
                            buildAccountSelectMenu(),
                            buildButtons(),
                        ],
                    });

                    return true;
                }

                if (customId === 'fnacc_view_account') {
                    const selectedId = await getSelectedAccount(client, guildId, interaction.user.id);

                    if (!selectedId) {
                        await interaction.reply({
                            content: '❌ Select an account from the dropdown menu first.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const account = getAccountById(selectedId);

                    if (!account) {
                        await interaction.reply({
                            content: '❌ Selected account was not found.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const embed = buildAccountEmbed(account, config, interaction.user);

                    await interaction.reply({
                        embeds: [embed],
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }

                if (customId === 'fnacc_buy_account') {
                    const selectedId = await getSelectedAccount(client, guildId, interaction.user.id);

                    if (!selectedId) {
                        await interaction.reply({
                            content: '❌ Select an account from the dropdown menu first.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const account = getAccountById(selectedId);

                    if (!account) {
                        await interaction.reply({
                            content: '❌ Selected account was not found.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const paypalUrl = buildPaypalUrl(config.paypal, account.price);

                    const buyEmbed = new EmbedBuilder()
                        .setTitle('💳 Buy Fortnite Account')
                        .setColor('#57F287')
                        .setDescription(
                            `You selected **${account.name}**.\n\n` +
                            `**Price:** ${formatMoney(account.price)}\n` +
                            `**Payment:** PayPal\n\n` +
                            `Click the button below to pay. After payment, contact staff or wait for delivery confirmation.`
                        )
                        .addFields(
                            {
                                name: '🎮 Account',
                                value: account.name,
                                inline: true,
                            },
                            {
                                name: '💰 Amount',
                                value: formatMoney(account.price),
                                inline: true,
                            },
                            {
                                name: '⚡ Delivery',
                                value: config.delivery || 'Manual delivery after payment confirmation',
                                inline: false,
                            },
                        )
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel(`Pay ${formatMoney(account.price)}`)
                            .setEmoji('💳')
                            .setStyle(ButtonStyle.Link)
                            .setURL(paypalUrl),
                    );

                    await interaction.reply({
                        embeds: [buyEmbed],
                        components: [row],
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }

                if (customId === 'fnacc_my_account') {
                    const userData = await getUserData(client, guildId, interaction.user.id);
                    const embed = buildMyAccountEmbed(config, userData, interaction.user);

                    await interaction.reply({
                        embeds: [embed],
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error('FNACC interaction error:', {
                error: error.message,
                stack: error.stack,
                customId: interaction.customId,
                userId: interaction.user?.id,
                guildId: interaction.guildId,
            });

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Something went wrong with the FN account shop.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }

            return true;
        }
    },
};

export default fnaccCommand;
