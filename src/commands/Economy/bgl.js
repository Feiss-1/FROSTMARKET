function generateConfirmationNumber() {
    return `#${Math.floor(10 + Math.random() * 90)}`;
}

function formatBgl(amount) {
    return `${Number(amount || 0).toFixed(0)} BGL`;
}

function formatDlFromBgl(amount) {
    return `${Number((amount || 0) * 100).toLocaleString('en-US')} DL`;
}

function formatRate(price) {
    return `${Number(price || 0).toFixed(2)}€/BGL`;
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

function buildTipSentEmbed(config, {
    bglAmount,
    totalCost,
    rate,
    confirmation,
    proofImage,
}, guild) {
    const guildName = guild?.name || config.shopName || 'M4SA Shop';
    const guildIcon = guild?.iconURL?.({ dynamic: true }) || undefined;

    const embed = new EmbedBuilder()
        .setColor('#00ff7f')
        .setTitle('Tip Sent')
        .addFields(
            {
                name: 'Amount Sent',
                value: `\`${formatBgl(bglAmount)} (${formatDlFromBgl(bglAmount)})\``,
                inline: false,
            },
            {
                name: 'Cost',
                value: `\`${formatMoney(totalCost)}\``,
                inline: false,
            },
            {
                name: 'Rate',
                value: `\`${formatRate(rate)}\``,
                inline: false,
            },
            {
                name: 'Confirmation',
                value: `\`${confirmation}\``,
                inline: false,
            },
        )
        .setFooter({
            text: guildName,
            iconURL: guildIcon,
        })
        .setTimestamp();

    if (proofImage) {
        embed.setImage(proofImage);
    }

    return embed;
}

async function sendPublicShopLog(client, config, guild, embed) {
    const channelId = config.logChannelId || config.channelId;

    const channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        return null;
    }

    return await channel.send({
        embeds: [embed],
    });
}
