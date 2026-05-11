import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    ChannelType,
} from 'discord.js';

import { logger } from '../../utils/logger.js';

const OWNER_IDS = ['772345007469756436'];

const BGL_LISTENER_FLAG = Symbol.for('m4sa.bgl.listener');

const BGL_CONFIG_KEY = (guildId) => `bgl_shop_config_${guildId}`;
const BGL_USER_KEY = (guildId, userId) => `bgl_shop_user_${guildId}_${userId}`;
const BGL_PENDING_KEY = (guildId, userId) => `bgl_shop_pending_${guildId}_${userId}`;
const BGL_ORDER_KEY = (guildId, orderId) => `bgl_shop_order_${guildId}_${orderId}`;

function isOwner(userId) {
    return OWNER_IDS.includes(userId);
}

function isValidUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function ensureBglListener(client) {
    if (!client || client[BGL_LISTENER_FLAG]) return;

    client[BGL_LISTENER_FLAG] = true;

    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isButton() && !interaction.isModalSubmit()) return;

            const customId = interaction.customId || '';
            if (!customId.startsWith('bgl_')) return;

            await bglCommand.handleInteraction(interaction, client);
        } catch (error) {
            logger.error('BGL auto listener error:', {
                error: error.message,
                stack: error.stack,
                customId: interaction.customId,
                userId: interaction.user?.id,
                guildId: interaction.guildId,
            });

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ BGL system error.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
        }
    });

    logger.info('✅ BGL interaction listener registered automatically');
}

function formatMoney(amount) {
    return `${Number(amount || 0).toFixed(2)}€`;
}

function formatBgl(amount) {
    return `${Number(amount || 0).toFixed(2).replace('.00', '')} BGL`;
}

function formatDlFromBgl(amount) {
    return `${Number((amount || 0) * 100).toLocaleString('en-US')} DL`;
}

function formatRate(price) {
    return `${Number(price || 0).toFixed(2)}€/BGL`;
}

function generateDepositNote() {
    const part1 = Math.random().toString(36).substring(2, 7).toUpperCase();
    const part2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `FLOW-${part1}-${part2}`;
}

function generateOrderId() {
    return `#${Math.floor(10 + Math.random() * 90)}`;
}

async function getUserData(client, guildId, userId) {
    const defaultData = {
        balance: 0,
        points: 0,
        allTimeBought: 0,
        rank: 'Member',
        createdAt: new Date().toISOString(),
    };

    if (!client.db) return defaultData;

    const data = await client.db.get(BGL_USER_KEY(guildId, userId));
    return data || defaultData;
}

async function saveUserData(client, guildId, userId, data) {
    if (!client.db) return;
    await client.db.set(BGL_USER_KEY(guildId, userId), data);
}

async function getShopConfig(client, guildId) {
    if (!client.db) return null;
    return await client.db.get(BGL_CONFIG_KEY(guildId));
}

async function saveShopConfig(client, guildId, config) {
    if (!client.db) return;
    await client.db.set(BGL_CONFIG_KEY(guildId), config);
}

async function deleteDbKey(client, key) {
    if (!client.db) return;

    if (typeof client.db.delete === 'function') {
        await client.db.delete(key);
        return;
    }

    if (typeof client.db.del === 'function') {
        await client.db.del(key);
        return;
    }

    await client.db.set(key, null);
}

async function sendPublicShopLog(client, config, embed) {
    const channelId = config.logChannelId || config.channelId;
    const channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        return null;
    }

    return await channel.send({
        embeds: [embed],
    });
}

function buildShopEmbed(config, guild) {
    const price = Number(config.price || 1);
    const min = Number(config.min || 1);
    const max = Number(config.max || 500);

    const guildName = guild?.name || config.shopName || 'M4SA Shop';
    const guildIcon = guild?.iconURL?.({ dynamic: true }) || undefined;

    const embed = new EmbedBuilder()
        .setTitle(config.title || '💎 M4SA BGL SHOP')
        .setDescription(
            config.description ||
            'Welcome to **M4SA Shop**!\n\nUse the buttons below to deposit, buy BGLs, check your account, or refresh the panel.'
        )
        .setColor(config.color || '#00ff7f')
        .addFields(
            {
                name: '💎 BGL Price',
                value: `\`${formatMoney(price)} / BGL\`\n1 BGL = 100 DL`,
                inline: true,
            },
            {
                name: '📦 Order Limits',
                value: `Min: \`${min}\` BGL\nMax: \`${max}\` BGL`,
                inline: true,
            },
            {
                name: '⚡ Shop Status',
                value: `\`${config.status || 'Online'}\``,
                inline: true,
            },
            {
                name: '💳 Payment',
                value: 'PayPal Friends & Family',
                inline: true,
            },
            {
                name: '🛒 Delivery',
                value: 'Manual delivery after confirmation',
                inline: true,
            },
            {
                name: '🔄 Balance',
                value: 'Deposit first, then buy BGLs automatically from your balance.',
                inline: true,
            },
        )
        .setFooter({
            text: `${guildName} • deposit / buy`,
            iconURL: guildIcon,
        })
        .setTimestamp();

    if (config.image) embed.setImage(config.image);
    if (config.thumbnail) embed.setThumbnail(config.thumbnail);

    return embed;
}

function buildShopButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('bgl_deposit')
            .setLabel('Deposit')
            .setEmoji('💳')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('bgl_buy')
            .setLabel('Buy BGLs')
            .setEmoji('💎')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('bgl_account')
            .setLabel('My Account')
            .setEmoji('👤')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('bgl_refresh')
            .setLabel('Refresh')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary),
    );
}

function buildDepositEmbed(config, amount, note, user) {
    const embed = new EmbedBuilder()
        .setTitle('💳 Deposit — PayPal F&F')
        .setColor('#00ff7f')
        .setDescription(
            `**Deposit ${formatMoney(amount)}** via PayPal Friends & Family:\n\n` +
            `**📧 PayPal address / link:**\n` +
            `\`${config.paypal}\`\n\n` +
            `**📝 Enter EXACTLY this in the NOTE field:**\n` +
            `\`${note}\`\n\n` +
            `⚠️ **Note is required** — the bot identifies your payment by it.\n\n` +
            `🤖 After paying, press **I've Paid**.\n` +
            `Your balance will be added after owner confirmation.`
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({
            text: `${config.shopName || 'M4SA Shop'} • Deposit`,
            iconURL: user.displayAvatarURL({ dynamic: true }),
        })
        .setTimestamp();

    return embed;
}

function buildDepositButtons(config, userId, note) {
    const rows = [];

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bgl_copy_note:${userId}`)
            .setLabel('Copy Note')
            .setEmoji('🧾')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId(`bgl_paid_confirm:${userId}`)
            .setLabel("I've Paid")
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
    );

    rows.push(row1);

    if (isValidUrl(config.paypal)) {
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Pay via PayPal')
                .setEmoji('💸')
                .setStyle(ButtonStyle.Link)
                .setURL(config.paypal),
        );

        rows.push(row2);
    }

    return rows;
}

function buildAccountEmbed(config, userData, user) {
    const price = Number(config.price || 1);
    const balance = Number(userData.balance || 0);
    const maxBgl = Math.floor((balance / price) * 100) / 100;

    const progressMax = 30;
    const points = Number(userData.points || 0);
    const progress = Math.min(points, progressMax);
    const filled = Math.round((progress / progressMax) * 10);
    const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled);

    return new EmbedBuilder()
        .setTitle(`👤 ${user.username}'s Account`)
        .setColor('#00ff7f')
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            {
                name: '🏷️ Rank',
                value: `**${userData.rank || 'Member'}**`,
                inline: true,
            },
            {
                name: '💰 Balance',
                value: `**${formatMoney(balance)}**`,
                inline: true,
            },
            {
                name: '💎 Can Buy',
                value: `**${formatBgl(maxBgl)}**`,
                inline: true,
            },
            {
                name: '🎟️ Points',
                value: `**${points} pts**`,
                inline: true,
            },
            {
                name: '📈 Progress',
                value: `\`${bar}\`\n${points} / ${progressMax} pts`,
                inline: false,
            },
            {
                name: '💎 All-time Bought',
                value: `**${formatBgl(userData.allTimeBought || 0)}**`,
                inline: true,
            },
            {
                name: '🛒 Ready to Buy',
                value: balance >= price
                    ? 'Press **Buy BGLs**'
                    : 'Deposit first to start buying.',
                inline: true,
            },
        )
        .setFooter({
            text: `${config.shopName || 'M4SA Shop'} • Account Stats`,
        })
        .setTimestamp();
}

function buildBalanceUpdatedEmbed(config, addedAmount, newBalance, guild) {
    const guildName = guild?.name || config.shopName || 'M4SA Shop';
    const guildIcon = guild?.iconURL?.({ dynamic: true }) || undefined;

    return new EmbedBuilder()
        .setColor('#00ff7f')
        .setTitle('💰 Balance Updated')
        .setDescription(
            `Admin added **+${formatMoney(addedAmount)}** to your balance!\n` +
            `New balance: **${formatMoney(newBalance)}**`
        )
        .setFooter({
            text: guildName,
            iconURL: guildIcon,
        })
        .setTimestamp();
}

function buildOrderConfirmedEmbed(config, data, guild) {
    const guildName = guild?.name || config.shopName || 'M4SA Shop';
    const guildIcon = guild?.iconURL?.({ dynamic: true }) || undefined;

    return new EmbedBuilder()
        .setColor('#00ff7f')
        .setTitle('Order Confirmed')
        .addFields(
            {
                name: 'Amount',
                value: `\`${formatBgl(data.bglAmount)} (${formatDlFromBgl(data.bglAmount)})\``,
                inline: false,
            },
            {
                name: 'Cost',
                value: `\`${formatMoney(data.totalCost)}\``,
                inline: false,
            },
            {
                name: 'Rate',
                value: `\`${formatRate(data.rate)}\``,
                inline: false,
            },
            {
                name: 'Gamblit',
                value: `\`${data.gamblitName}\``,
                inline: false,
            },
            {
                name: 'Order',
                value: `\`${data.orderId}\``,
                inline: false,
            },
            {
                name: 'Balance',
                value: `\`${formatMoney(data.newBalance)}\``,
                inline: false,
            },
        )
        .setFooter({
            text: guildName,
            iconURL: guildIcon,
        })
        .setTimestamp();
}

function buildDeliveredDmEmbed(config, order, proofImage) {
    const embed = new EmbedBuilder()
        .setColor('#00ff7f')
        .setTitle('✅ BGL Delivered')
        .setDescription(
            `Your BGL order has been delivered to your Gamblit.net account.\n\n` +
            `**Amount:** ${formatBgl(order.bglAmount)} (${formatDlFromBgl(order.bglAmount)})\n` +
            `**Gamblit:** \`${order.gamblitName}\`\n` +
            `**Order:** \`${order.orderId}\`\n\n` +
            `Thank you for buying from **${config.shopName || 'M4SA Shop'}**.`
        )
        .setTimestamp();

    if (proofImage) {
        embed.setImage(proofImage);
    }

    return embed;
}

const bglCommand = {
    data: new SlashCommandBuilder()
        .setName('bgl')
        .setDescription('Owner-only BGL shop panel setup.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel where the BGL shop panel will be sent.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
        )

        .addChannelOption(option =>
            option
                .setName('log_channel')
                .setDescription('Channel where deposit and order logs are sent.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false),
        )

        .addStringOption(option =>
            option
                .setName('paypal')
                .setDescription('PayPal email or PayPal payment link.')
                .setRequired(true),
        )

        .addNumberOption(option =>
            option
                .setName('price')
                .setDescription('BGL price in euros. Example: 0.90')
                .setRequired(true),
        )

        .addIntegerOption(option =>
            option
                .setName('min')
                .setDescription('Minimum BGL order amount.')
                .setMinValue(1)
                .setRequired(false),
        )

        .addIntegerOption(option =>
            option
                .setName('max')
                .setDescription('Maximum BGL order amount.')
                .setMinValue(1)
                .setRequired(false),
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
                .setName('status')
                .setDescription('Shop status. Example: Online, Restocking, Closed')
                .setRequired(false),
        ),

    category: 'owner',

    async execute(interaction, config, client) {
        try {
            ensureBglListener(client);

            if (!isOwner(interaction.user.id)) {
                return await interaction.reply({
                    content: '❌ Only the bot owner can use this command.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const channel = interaction.options.getChannel('channel');
            const logChannel = interaction.options.getChannel('log_channel');
            const paypal = interaction.options.getString('paypal');
            const price = interaction.options.getNumber('price');
            const min = interaction.options.getInteger('min') || 1;
            const max = interaction.options.getInteger('max') || 500;
            const image = interaction.options.getString('image');
            const thumbnail = interaction.options.getString('thumbnail');
            const title = interaction.options.getString('title') || '💎 M4SA BGL SHOP';
            const description =
                interaction.options.getString('description') ||
                'Welcome to **M4SA Shop**!\n\nUse the buttons below to deposit, buy BGLs, check your account, or refresh the panel.';
            const status = interaction.options.getString('status') || 'Online';

            if (!channel || !channel.isTextBased()) {
                return await interaction.reply({
                    content: '❌ Selected channel is not text based.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (logChannel && !logChannel.isTextBased()) {
                return await interaction.reply({
                    content: '❌ Selected log channel is not text based.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const shopConfig = {
                guildId: interaction.guildId,
                guildName: interaction.guild.name,
                channelId: channel.id,
                logChannelId: logChannel?.id || channel.id,
                paypal,
                price,
                min,
                max,
                image: image || null,
                thumbnail: thumbnail || null,
                title,
                description,
                status,
                color: '#00ff7f',
                shopName: interaction.guild.name,
                createdBy: interaction.user.id,
                updatedAt: new Date().toISOString(),
            };

            const embed = buildShopEmbed(shopConfig, interaction.guild);
            const buttons = buildShopButtons();

            const panelMessage = await channel.send({
                embeds: [embed],
                components: [buttons],
            });

            shopConfig.messageId = panelMessage.id;

            await saveShopConfig(client, interaction.guildId, shopConfig);

            return await interaction.reply({
                content:
                    `✅ BGL shop panel created in ${channel}.\n` +
                    `✅ Logs will be sent in ${logChannel || channel}.\n\n` +
                    `**PayPal:** ${paypal}\n` +
                    `**Price:** ${formatMoney(price)} / BGL\n` +
                    `**Min:** ${min} BGL\n` +
                    `**Max:** ${max} BGL\n\n` +
                    `✅ Buttons are now active automatically.`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('BGL command error:', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user?.id,
                guildId: interaction.guildId,
            });

            if (interaction.replied || interaction.deferred) {
                return await interaction.editReply({
                    content: '❌ Failed to create BGL shop panel.',
                }).catch(() => {});
            }

            return await interaction.reply({
                content: '❌ Failed to create BGL shop panel.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    },

    async handleInteraction(interaction, client) {
        try {
            if (!interaction.isButton() && !interaction.isModalSubmit()) {
                return false;
            }

            const customId = interaction.customId || '';

            if (!customId.startsWith('bgl_')) {
                return false;
            }

            if (interaction.isButton()) {
                if (customId.startsWith('bgl_owner_approve:')) {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: '❌ Owner only.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const [, , guildId, userId] = customId.split(':');
                    const pendingKey = BGL_PENDING_KEY(guildId, userId);
                    const pending = await client.db.get(pendingKey);

                    if (!pending) {
                        await interaction.reply({
                            content: '❌ Pending deposit not found.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const userData = await getUserData(client, guildId, userId);
                    userData.balance = Number(userData.balance || 0) + Number(pending.amount || 0);

                    await saveUserData(client, guildId, userId, userData);
                    await deleteDbKey(client, pendingKey);

                    const shopConfig = await getShopConfig(client, guildId);
                    const guild = interaction.client.guilds.cache.get(guildId);

                    if (shopConfig && guild) {
                        const balanceEmbed = buildBalanceUpdatedEmbed(
                            shopConfig,
                            pending.amount,
                            userData.balance,
                            guild,
                        );

                        await sendPublicShopLog(client, shopConfig, balanceEmbed);
                    }

                    await interaction.update({
                        content:
                            `✅ Deposit approved.\n\n` +
                            `**User:** <@${userId}>\n` +
                            `**Amount:** ${formatMoney(pending.amount)}\n` +
                            `**New Balance:** ${formatMoney(userData.balance)}`,
                        components: [],
                    });

                    const user = await interaction.client.users.fetch(userId).catch(() => null);

                    if (user) {
                        await user.send(
                            `✅ Your deposit of **${formatMoney(pending.amount)}** has been confirmed.\n` +
                            `Your new balance is **${formatMoney(userData.balance)}**.`
                        ).catch(() => {});
                    }

                    return true;
                }

                if (customId.startsWith('bgl_owner_deny:')) {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: '❌ Owner only.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const [, , guildId, userId] = customId.split(':');
                    const pendingKey = BGL_PENDING_KEY(guildId, userId);

                    await deleteDbKey(client, pendingKey);

                    await interaction.update({
                        content: `❌ Deposit denied for <@${userId}>.`,
                        components: [],
                    });

                    const user = await interaction.client.users.fetch(userId).catch(() => null);

                    if (user) {
                        await user.send(
                            '❌ Your deposit was denied. Please contact staff if this was a mistake.'
                        ).catch(() => {});
                    }

                    return true;
                }

                if (customId.startsWith('bgl_owner_deliver:')) {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: '❌ Owner only.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const [, , guildId, orderId] = customId.split(':');

                    const modal = new ModalBuilder()
                        .setCustomId(`bgl_deliver_modal:${guildId}:${orderId}`)
                        .setTitle('✅ Mark Delivered');

                    const proofInput = new TextInputBuilder()
                        .setCustomId('proof_image')
                        .setLabel('Proof image URL')
                        .setPlaceholder('Paste delivery screenshot image URL')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(proofInput),
                    );

                    await interaction.showModal(modal);
                    return true;
                }

                if (customId.startsWith('bgl_owner_cancel_order:')) {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: '❌ Owner only.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const [, , guildId, orderId] = customId.split(':');
                    const orderKey = BGL_ORDER_KEY(guildId, orderId);
                    const order = await client.db.get(orderKey);

                    if (!order) {
                        await interaction.reply({
                            content: '❌ Order not found.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const userData = await getUserData(client, guildId, order.userId);
                    userData.balance = Number(userData.balance || 0) + Number(order.totalCost || 0);

                    await saveUserData(client, guildId, order.userId, userData);
                    await deleteDbKey(client, orderKey);

                    await interaction.update({
                        content:
                            `❌ Order cancelled and refunded.\n\n` +
                            `**User:** <@${order.userId}>\n` +
                            `**Refund:** ${formatMoney(order.totalCost)}\n` +
                            `**New Balance:** ${formatMoney(userData.balance)}`,
                        components: [],
                    });

                    const user = await interaction.client.users.fetch(order.userId).catch(() => null);

                    if (user) {
                        await user.send(
                            `❌ Your order ${order.orderId} was cancelled.\n` +
                            `You were refunded **${formatMoney(order.totalCost)}**.\n` +
                            `New balance: **${formatMoney(userData.balance)}**.`
                        ).catch(() => {});
                    }

                    return true;
                }
            }

            const guildId = interaction.guildId;

            if (!guildId) {
                await interaction.reply({
                    content: '❌ This button can only be used inside the server.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                return true;
            }

            const config = await getShopConfig(client, guildId);

            if (!config) {
                await interaction.reply({
                    content: '❌ BGL shop is not configured. Use `/bgl` first.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                return true;
            }

            if (interaction.isButton()) {
                if (customId === 'bgl_refresh') {
                    const embed = buildShopEmbed(config, interaction.guild);
                    const buttons = buildShopButtons();

                    await interaction.update({
                        embeds: [embed],
                        components: [buttons],
                    });

                    return true;
                }

                if (customId === 'bgl_deposit') {
                    const modal = new ModalBuilder()
                        .setCustomId('bgl_deposit_modal')
                        .setTitle('Deposit');

                    const amountInput = new TextInputBuilder()
                        .setCustomId('amount')
                        .setLabel('Amount (€)')
                        .setPlaceholder('Example: 1.00')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(amountInput),
                    );

                    await interaction.showModal(modal);
                    return true;
                }

                if (customId === 'bgl_account') {
                    const userData = await getUserData(client, guildId, interaction.user.id);
                    const embed = buildAccountEmbed(config, userData, interaction.user);

                    await interaction.reply({
                        embeds: [embed],
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }

                if (customId === 'bgl_buy') {
                    const userData = await getUserData(client, guildId, interaction.user.id);
                    const minCost = Number(config.price || 0) * Number(config.min || 1);

                    if (Number(userData.balance || 0) < minCost) {
                        await interaction.reply({
                            content:
                                `❌ Your balance is **${formatMoney(userData.balance)}**.\n` +
                                `Minimum order needs **${formatMoney(minCost)}**.\n\n` +
                                `Press **Deposit** first.`,
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const modal = new ModalBuilder()
                        .setCustomId('bgl_buy_modal')
                        .setTitle('💎 Buy BGLs');

                    const amountInput = new TextInputBuilder()
                        .setCustomId('bgl_amount')
                        .setLabel(`Amount BGL (1 BGL = 100 DL = ${formatMoney(config.price)})`)
                        .setPlaceholder(`e.g. 1 (min ${config.min}, max ${config.max})`)
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    const gamblitInput = new TextInputBuilder()
                        .setCustomId('gamblit_name')
                        .setLabel('Gamblit.net username')
                        .setPlaceholder('Your username on Gamblit.net')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(amountInput),
                        new ActionRowBuilder().addComponents(gamblitInput),
                    );

                    await interaction.showModal(modal);
                    return true;
                }

                if (customId.startsWith('bgl_copy_note:')) {
                    const userId = customId.split(':')[1];

                    if (interaction.user.id !== userId) {
                        await interaction.reply({
                            content: '❌ This deposit note is not yours.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const pending = await client.db.get(BGL_PENDING_KEY(guildId, userId));

                    if (!pending) {
                        await interaction.reply({
                            content: '❌ No pending deposit found.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    await interaction.reply({
                        content: `Copy this note and paste it into PayPal:\n\n\`${pending.note}\``,
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }

                if (customId.startsWith('bgl_paid_confirm:')) {
                    const userId = customId.split(':')[1];

                    if (interaction.user.id !== userId) {
                        await interaction.reply({
                            content: '❌ This deposit is not yours.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const pending = await client.db.get(BGL_PENDING_KEY(guildId, userId));

                    if (!pending) {
                        await interaction.reply({
                            content: '❌ No pending deposit found.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    await interaction.reply({
                        content:
                            `✅ Payment marked as sent.\n\n` +
                            `Your deposit **${formatMoney(pending.amount)}** is waiting for owner confirmation.`,
                        flags: MessageFlags.Ephemeral,
                    });

                    const ownerRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bgl_owner_approve:${guildId}:${userId}`)
                            .setLabel('Approve Deposit')
                            .setEmoji('✅')
                            .setStyle(ButtonStyle.Success),

                        new ButtonBuilder()
                            .setCustomId(`bgl_owner_deny:${guildId}:${userId}`)
                            .setLabel('Deny Deposit')
                            .setEmoji('❌')
                            .setStyle(ButtonStyle.Danger),
                    );

                    for (const ownerId of OWNER_IDS) {
                        const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
                        if (!owner) continue;

                        await owner.send({
                            content:
                                `💳 **New BGL deposit waiting for confirmation**\n\n` +
                                `**User:** <@${userId}>\n` +
                                `**Amount:** ${formatMoney(pending.amount)}\n` +
                                `**PayPal:** ${config.paypal}\n` +
                                `**Note:** \`${pending.note}\`\n` +
                                `**Guild:** ${interaction.guild.name}`,
                            components: [ownerRow],
                        }).catch(() => {});
                    }

                    return true;
                }
            }

            if (interaction.isModalSubmit()) {
                if (customId === 'bgl_deposit_modal') {
                    const amountRaw = interaction.fields.getTextInputValue('amount');
                    const amount = Number(String(amountRaw).replace(',', '.'));

                    if (!amount || amount <= 0) {
                        await interaction.reply({
                            content: '❌ Invalid amount.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const note = generateDepositNote();

                    const pending = {
                        userId: interaction.user.id,
                        guildId,
                        guildName: interaction.guild.name,
                        amount,
                        note,
                        createdAt: new Date().toISOString(),
                    };

                    await client.db.set(
                        BGL_PENDING_KEY(guildId, interaction.user.id),
                        pending,
                    );

                    const embed = buildDepositEmbed(
                        config,
                        amount,
                        note,
                        interaction.user,
                    );

                    const rows = buildDepositButtons(config, interaction.user.id, note);

                    await interaction.reply({
                        embeds: [embed],
                        components: rows,
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }

                if (customId === 'bgl_buy_modal') {
                    const bglAmountRaw = interaction.fields.getTextInputValue('bgl_amount');
                    const gamblitName = interaction.fields.getTextInputValue('gamblit_name');

                    const bglAmount = Number(String(bglAmountRaw).replace(',', '.'));

                    if (!bglAmount || bglAmount <= 0) {
                        await interaction.reply({
                            content: '❌ Invalid BGL amount.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    if (
                        bglAmount < Number(config.min || 1) ||
                        bglAmount > Number(config.max || 500)
                    ) {
                        await interaction.reply({
                            content: `❌ Order amount must be between **${config.min}** and **${config.max}** BGL.`,
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const rate = Number(config.price || 0);
                    const totalCost = Number((bglAmount * rate).toFixed(2));

                    const userData = await getUserData(client, guildId, interaction.user.id);

                    if (Number(userData.balance || 0) < totalCost) {
                        const canBuy = Math.floor((Number(userData.balance || 0) / rate) * 100) / 100;

                        await interaction.reply({
                            content:
                                `❌ Not enough balance.\n\n` +
                                `**Needed:** ${formatMoney(totalCost)}\n` +
                                `**Your balance:** ${formatMoney(userData.balance)}\n` +
                                `**You can buy:** ${formatBgl(canBuy)}`,
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    userData.balance = Number((Number(userData.balance || 0) - totalCost).toFixed(2));
                    userData.allTimeBought = Number(userData.allTimeBought || 0) + bglAmount;
                    userData.points = Number(userData.points || 0) + Math.floor(bglAmount);

                    if (userData.points >= 30) {
                        userData.rank = 'Silver Buyer';
                    }

                    await saveUserData(client, guildId, interaction.user.id, userData);

                    const orderId = generateOrderId();

                    const order = {
                        orderId,
                        guildId,
                        guildName: interaction.guild.name,
                        userId: interaction.user.id,
                        userTag: interaction.user.tag,
                        gamblitName,
                        bglAmount,
                        totalCost,
                        rate,
                        newBalance: userData.balance,
                        status: 'pending_delivery',
                        createdAt: new Date().toISOString(),
                    };

                    await client.db.set(BGL_ORDER_KEY(guildId, orderId), order);

                    const confirmedEmbed = buildOrderConfirmedEmbed(config, order, interaction.guild);

                    await sendPublicShopLog(client, config, confirmedEmbed);

                    const ownerRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bgl_owner_deliver:${guildId}:${orderId}`)
                            .setLabel('Mark Delivered')
                            .setEmoji('✅')
                            .setStyle(ButtonStyle.Success),

                        new ButtonBuilder()
                            .setCustomId(`bgl_owner_cancel_order:${guildId}:${orderId}`)
                            .setLabel('Cancel + Refund')
                            .setEmoji('❌')
                            .setStyle(ButtonStyle.Danger),
                    );

                    for (const ownerId of OWNER_IDS) {
                        const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
                        if (!owner) continue;

                        await owner.send({
                            content:
                                `💎 **New BGL Order**\n\n` +
                                `**User:** ${interaction.user.tag} (${interaction.user.id})\n` +
                                `**Gamblit:** \`${gamblitName}\`\n` +
                                `**Amount:** ${formatBgl(bglAmount)} (${formatDlFromBgl(bglAmount)})\n` +
                                `**Cost:** ${formatMoney(totalCost)}\n` +
                                `**Rate:** ${formatRate(rate)}\n` +
                                `**Order:** \`${orderId}\`\n` +
                                `**User balance left:** ${formatMoney(userData.balance)}\n` +
                                `**Guild:** ${interaction.guild.name}`,
                            components: [ownerRow],
                        }).catch(() => {});
                    }

                    await interaction.reply({
                        content:
                            `✅ Order confirmed!\n\n` +
                            `**Amount:** ${formatBgl(bglAmount)} (${formatDlFromBgl(bglAmount)})\n` +
                            `**Cost:** ${formatMoney(totalCost)}\n` +
                            `**Rate:** ${formatRate(rate)}\n` +
                            `**Gamblit:** \`${gamblitName}\`\n` +
                            `**Order:** \`${orderId}\`\n` +
                            `**Balance left:** ${formatMoney(userData.balance)}\n\n` +
                            `Staff will deliver your BGLs soon. You will get a DM with proof when delivered.`,
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }

                if (customId.startsWith('bgl_deliver_modal:')) {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: '❌ Owner only.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const [, guildIdFromModal, orderId] = customId.split(':');
                    const proofImage = interaction.fields.getTextInputValue('proof_image');

                    if (!isValidUrl(proofImage)) {
                        await interaction.reply({
                            content: '❌ Proof image must be a valid URL.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const orderKey = BGL_ORDER_KEY(guildIdFromModal, orderId);
                    const order = await client.db.get(orderKey);

                    if (!order) {
                        await interaction.reply({
                            content: '❌ Order not found.',
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    const shopConfig = await getShopConfig(client, guildIdFromModal);

                    order.status = 'delivered';
                    order.deliveredAt = new Date().toISOString();
                    order.deliveredBy = interaction.user.id;
                    order.proofImage = proofImage;

                    await client.db.set(orderKey, order);

                    const user = await interaction.client.users.fetch(order.userId).catch(() => null);

                    if (user && shopConfig) {
                        const dmEmbed = buildDeliveredDmEmbed(shopConfig, order, proofImage);

                        await user.send({
                            embeds: [dmEmbed],
                        }).catch(() => {});
                    }

                    await interaction.reply({
                        content:
                            `✅ Order marked as delivered.\n\n` +
                            `**User:** <@${order.userId}>\n` +
                            `**Gamblit:** \`${order.gamblitName}\`\n` +
                            `**Amount:** ${formatBgl(order.bglAmount)}\n` +
                            `**Order:** \`${order.orderId}\`\n\n` +
                            `The user has been sent a DM with the proof image.`,
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error('BGL interaction error:', {
                error: error.message,
                stack: error.stack,
                customId: interaction.customId,
                userId: interaction.user?.id,
                guildId: interaction.guildId,
            });

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Something went wrong with the BGL system.',
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }

            return true;
        }
    },
};

export default bglCommand;
