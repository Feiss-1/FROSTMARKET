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
} from 'discord.js';

import { logger } from '../../utils/logger.js';

const BGL_CONFIG_KEY = (guildId) => `bgl_shop_config_${guildId}`;
const BGL_USER_KEY = (guildId, userId) => `bgl_shop_user_${guildId}_${userId}`;
const BGL_PENDING_KEY = (guildId, userId) => `bgl_shop_pending_${guildId}_${userId}`;

function isOwner(userId) {
    const owners = process.env.OWNER_IDS
        ? process.env.OWNER_IDS.split(',').map(id => id.trim()).filter(Boolean)
        : [];

    return owners.includes(userId);
}

function formatMoney(amount) {
    return `${Number(amount || 0).toFixed(2)}€`;
}

function generateDepositNote() {
    const part1 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const part2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `FLOW-${part1}-${part2}`;
}

async function getUserData(client, guildId, userId) {
    const key = BGL_USER_KEY(guildId, userId);

    const defaultData = {
        balance: 0,
        points: 0,
        allTimeBought: 0,
        rank: 'Member',
        createdAt: new Date().toISOString(),
    };

    if (!client.db) return defaultData;

    const data = await client.db.get(key);
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

function buildShopEmbed(config, guild) {
    const price = Number(config.price || 0.89);
    const min = Number(config.min || 1);
    const max = Number(config.max || 500);

    const embed = new EmbedBuilder()
        .setTitle(config.title || '🛒 BGL SHOP')
        .setDescription(config.description || 'Instant delivery • PayPal F&F • Manual confirmation')
        .setColor(config.color || '#00d5ff')
        .addFields(
            {
                name: '💎 BGL Price',
                value: `\`${formatMoney(price)} per BGL\`\n1 BGL = 100 DL`,
                inline: true,
            },
            {
                name: '📦 Order Size',
                value: `Min \`${min}\` — Max \`${max}\` BGL`,
                inline: true,
            },
            {
                name: '⚡ Status',
                value: config.status || 'Online',
                inline: true,
            },
        )
        .setFooter({
            text: `${guild.name} • Payments via PayPal F&F`,
            iconURL: guild.iconURL({ dynamic: true }) || undefined,
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
            .setEmoji('🛒')
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
    return new EmbedBuilder()
        .setTitle('💳 Deposit — PayPal F&F')
        .setColor('#5865F2')
        .setDescription(
            `Send exactly **${formatMoney(amount)}** via PayPal **Friends & Family**.\n\n` +
            `**📧 PayPal address:**\n\`${config.paypal}\`\n\n` +
            `**📝 Note — copy exactly:**\n\`${note}\`\n\n` +
            `⏳ Expires in **10 minutes**.\n\n` +
            `🤖 Payment is checked manually. Press **I’ve Paid** after sending.`
        )
        .setFooter({
            text: `${config.shopName || 'BGL Shop'} • Deposit`,
            iconURL: user.displayAvatarURL({ dynamic: true }),
        })
        .setTimestamp();
}

function buildAccountEmbed(config, userData, user) {
    const progressMax = 30;
    const points = Number(userData.points || 0);
    const progress = Math.min(points, progressMax);
    const filled = Math.round((progress / progressMax) * 10);
    const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled);

    return new EmbedBuilder()
        .setTitle(`👤 ${user.username}`)
        .setColor('#5865F2')
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            {
                name: 'Member',
                value: userData.rank || 'Member',
                inline: true,
            },
            {
                name: '💰 Balance',
                value: `**${formatMoney(userData.balance)}**`,
                inline: true,
            },
            {
                name: '🎟️ Points',
                value: `**${points} pts**`,
                inline: true,
            },
            {
                name: '📈 Progress',
                value: `\`${bar}\`\n${points} / ${progressMax} pts — 30 pts to Silver Buyer`,
                inline: false,
            },
            {
                name: '💎 All-time Bought',
                value: `**${Number(userData.allTimeBought || 0)} BGL**`,
                inline: true,
            },
            {
                name: '🛒 Ready to Buy',
                value: Number(userData.balance || 0) > 0 ? 'Use **Buy BGLs**' : '*Deposit to start buying*',
                inline: true,
            },
        )
        .setFooter({
            text: `${config.shopName || 'BGL Shop'} • Member`,
        })
        .setTimestamp();
}

export default {
    data: new SlashCommandBuilder()
        .setName('bgl')
        .setDescription('Owner-only BGL shop panel setup.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel where the BGL shop panel will be sent.')
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName('paypal')
                .setDescription('PayPal address shown in deposit instructions.')
                .setRequired(true),
        )
        .addNumberOption(option =>
            option
                .setName('price')
                .setDescription('BGL price in euros. Example: 0.89')
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
                .setDescription('Small thumbnail/profile image URL for the shop embed.')
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
                .setDescription('Shop status text. Example: Online, Restocking, Closed')
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
            const paypal = interaction.options.getString('paypal');
            const price = interaction.options.getNumber('price');
            const min = interaction.options.getInteger('min') || 1;
            const max = interaction.options.getInteger('max') || 500;
            const image = interaction.options.getString('image');
            const thumbnail = interaction.options.getString('thumbnail');
            const title = interaction.options.getString('title') || '🛒 BGL SHOP';
            const description =
                interaction.options.getString('description') ||
                'Instant delivery • PayPal F&F • Manual confirmation';
            const status = interaction.options.getString('status') || 'Online';

            const shopConfig = {
                guildId: interaction.guildId,
                channelId: channel.id,
                paypal,
                price,
                min,
                max,
                image: image || null,
                thumbnail: thumbnail || null,
                title,
                description,
                status,
                color: '#00d5ff',
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
                    `✅ BGL shop panel created in ${channel}.\n\n` +
                    `**Price:** ${formatMoney(price)} / BGL\n` +
                    `**Min:** ${min} BGL\n` +
                    `**Max:** ${max} BGL\n` +
                    `**Image:** ${image ? 'Added' : 'None'}\n` +
                    `**Thumbnail:** ${thumbnail ? 'Added' : 'None'}`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('BGL command error:', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
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
            if (!interaction.guildId) return false;

            const config = await getShopConfig(client, interaction.guildId);
            if (!config) return false;

            if (interaction.isButton()) {
                if (interaction.customId === 'bgl_refresh') {
                    const embed = buildShopEmbed(config, interaction.guild);
                    const buttons = buildShopButtons();

                    await interaction.update({
                        embeds: [embed],
                        components: [buttons],
                    });

                    return true;
                }

                if (interaction.customId === 'bgl_deposit') {
                    const modal = new ModalBuilder()
                        .setCustomId('bgl_deposit_modal')
                        .setTitle('💳 Deposit Balance');

                    const amountInput = new TextInputBuilder()
                        .setCustomId('amount')
                        .setLabel('Amount (€)')
                        .setPlaceholder('e.g. 11.00')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(amountInput),
                    );

                    await interaction.showModal(modal);
                    return true;
                }

                if (interaction.customId === 'bgl_account') {
                    const userData = await getUserData(client, interaction.guildId, interaction.user.id);
                    const embed = buildAccountEmbed(config, userData, interaction.user);

                    await interaction.reply({
                        embeds: [embed],
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }

                if (interaction.customId === 'bgl_buy') {
                    const userData = await getUserData(client, interaction.guildId, interaction.user.id);
                    const minCost = Number(config.price || 0) * Number(config.min || 1);

                    if (Number(userData.balance || 0) < minCost) {
                        await interaction.reply({
                            content:
                                `❌ Your balance is **${formatMoney(userData.balance)}** — not enough. ` +
                                `(Min: **${formatMoney(minCost)}**)\nDeposit first: press **Deposit**.`,
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const modal = new ModalBuilder()
                        .setCustomId('bgl_buy_modal')
                        .setTitle('🛒 Buy BGLs');

                    const amountInput = new TextInputBuilder()
                        .setCustomId('amount')
                        .setLabel('How many BGLs do you want to buy?')
                        .setPlaceholder(`Min ${config.min} — Max ${config.max}`)
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(amountInput),
                    );

                    await interaction.showModal(modal);
                    return true;
                }

                if (interaction.customId.startsWith('bgl_paid_confirm:')) {
                    const userId = interaction.customId.split(':')[1];

                    if (interaction.user.id !== userId) {
                        await interaction.reply({
                            content: '❌ This deposit is not yours.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const pending = await client.db.get(BGL_PENDING_KEY(interaction.guildId, userId));

                    if (!pending) {
                        await interaction.reply({
                            content: '❌ No pending deposit found.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    await interaction.reply({
                        content:
                            `✅ Payment marked as sent.\n` +
                            `Your deposit **${formatMoney(pending.amount)}** is waiting for owner confirmation.`,
                        flags: MessageFlags.Ephemeral,
                    });

                    const ownerIds = process.env.OWNER_IDS
                        ? process.env.OWNER_IDS.split(',').map(id => id.trim()).filter(Boolean)
                        : [];

                    const ownerRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bgl_owner_approve:${userId}`)
                            .setLabel('Approve Deposit')
                            .setEmoji('✅')
                            .setStyle(ButtonStyle.Success),

                        new ButtonBuilder()
                            .setCustomId(`bgl_owner_deny:${userId}`)
                            .setLabel('Deny Deposit')
                            .setEmoji('❌')
                            .setStyle(ButtonStyle.Danger),
                    );

                    for (const ownerId of ownerIds) {
                        const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
                        if (!owner) continue;

                        await owner.send({
                            content:
                                `💳 **New BGL deposit waiting for confirmation**\n\n` +
                                `**User:** <@${userId}>\n` +
                                `**Amount:** ${formatMoney(pending.amount)}\n` +
                                `**Note:** \`${pending.note}\`\n` +
                                `**Guild:** ${interaction.guild.name}`,
                            components: [ownerRow],
                        }).catch(() => {});
                    }

                    return true;
                }

                if (interaction.customId.startsWith('bgl_owner_approve:')) {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: '❌ Owner only.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const userId = interaction.customId.split(':')[1];
                    const pending = await client.db.get(BGL_PENDING_KEY(interaction.guildId, userId));

                    if (!pending) {
                        await interaction.reply({
                            content: '❌ Pending deposit not found.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const userData = await getUserData(client, interaction.guildId, userId);
                    userData.balance = Number(userData.balance || 0) + Number(pending.amount || 0);

                    await saveUserData(client, interaction.guildId, userId, userData);
                    await client.db.delete(BGL_PENDING_KEY(interaction.guildId, userId));

                    await interaction.update({
                        content:
                            `✅ Deposit approved.\n\n` +
                            `**User:** <@${userId}>\n` +
                            `**Amount:** ${formatMoney(pending.amount)}`,
                        components: [],
                    });

                    const user = await interaction.client.users.fetch(userId).catch(() => null);
                    if (user) {
                        await user.send(
                            `✅ Your deposit of **${formatMoney(pending.amount)}** has been confirmed.`
                        ).catch(() => {});
                    }

                    return true;
                }

                if (interaction.customId.startsWith('bgl_owner_deny:')) {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: '❌ Owner only.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const userId = interaction.customId.split(':')[1];
                    await client.db.delete(BGL_PENDING_KEY(interaction.guildId, userId));

                    await interaction.update({
                        content: `❌ Deposit denied for <@${userId}>.`,
                        components: [],
                    });

                    const user = await interaction.client.users.fetch(userId).catch(() => null);
                    if (user) {
                        await user.send(
                            `❌ Your deposit was denied. Please contact staff if this was a mistake.`
                        ).catch(() => {});
                    }

                    return true;
                }
            }

            if (interaction.isModalSubmit()) {
                if (interaction.customId === 'bgl_deposit_modal') {
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
                        amount,
                        note,
                        createdAt: new Date().toISOString(),
                    };

                    await client.db.set(
                        BGL_PENDING_KEY(interaction.guildId, interaction.user.id),
                        pending,
                    );

                    const embed = buildDepositEmbed(config, amount, note, interaction.user);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bgl_paid_confirm:${interaction.user.id}`)
                            .setLabel("I've Paid")
                            .setEmoji('✅')
                            .setStyle(ButtonStyle.Success),
                    );

                    await interaction.reply({
                        embeds: [embed],
                        components: [row],
                        flags: MessageFlags.Ephemeral,
                    });

                    return true;
                }

                if (interaction.customId === 'bgl_buy_modal') {
                    const amountRaw = interaction.fields.getTextInputValue('amount');
                    const bglAmount = Number(String(amountRaw).replace(',', '.'));

                    if (!bglAmount || bglAmount <= 0) {
                        await interaction.reply({
                            content: '❌ Invalid BGL amount.',
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    if (bglAmount < Number(config.min || 1) || bglAmount > Number(config.max || 500)) {
                        await interaction.reply({
                            content: `❌ Order amount must be between **${config.min}** and **${config.max}** BGL.`,
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    const totalCost = bglAmount * Number(config.price || 0);
                    const userData = await getUserData(client, interaction.guildId, interaction.user.id);

                    if (Number(userData.balance || 0) < totalCost) {
                        await interaction.reply({
                            content:
                                `❌ Not enough balance.\n\n` +
                                `**Needed:** ${formatMoney(totalCost)}\n` +
                                `**Your balance:** ${formatMoney(userData.balance)}`,
                            flags: MessageFlags.Ephemeral,
                        });

                        return true;
                    }

                    userData.balance = Number(userData.balance || 0) - totalCost;
                    userData.allTimeBought = Number(userData.allTimeBought || 0) + bglAmount;
                    userData.points = Number(userData.points || 0) + Math.floor(bglAmount);

                    if (userData.points >= 30) {
                        userData.rank = 'Silver Buyer';
                    }

                    await saveUserData(client, interaction.guildId, interaction.user.id, userData);

                    await interaction.reply({
                        content:
                            `✅ Order created!\n\n` +
                            `**BGL:** ${bglAmount}\n` +
                            `**Cost:** ${formatMoney(totalCost)}\n` +
                            `**New balance:** ${formatMoney(userData.balance)}\n\n` +
                            `Staff will deliver your order soon.`,
                        flags: MessageFlags.Ephemeral,
                    });

                    const ownerIds = process.env.OWNER_IDS
                        ? process.env.OWNER_IDS.split(',').map(id => id.trim()).filter(Boolean)
                        : [];

                    for (const ownerId of ownerIds) {
                        const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
                        if (!owner) continue;

                        await owner.send(
                            `🛒 **New BGL order**\n\n` +
                            `**User:** ${interaction.user.tag} (${interaction.user.id})\n` +
                            `**Amount:** ${bglAmount} BGL\n` +
                            `**Cost:** ${formatMoney(totalCost)}\n` +
                            `**Guild:** ${interaction.guild.name}`
                        ).catch(() => {});
                    }

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
