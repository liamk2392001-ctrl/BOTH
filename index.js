const {
    Client,
    GatewayIntentBits,
    Partials,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events
} = require("discord.js");

const express = require("express");

// ==============================
// CONFIG
// ==============================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN לא מוגדר ב-Environment Variables");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("❌ CLIENT_ID לא מוגדר ב-Environment Variables");
    process.exit(1);
}

// ==============================
// DISCORD CLIENT
// ==============================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ],
    partials: [
        Partials.Channel
    ]
});

// ==============================
// WEB SERVER - RENDER
// ==============================

const app = express();

app.get("/", (req, res) => {
    res.send("Bot is online!");
});

app.get("/health", (req, res) => {
    res.json({
        online: true,
        bot: client.user ? client.user.tag : null
    });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// ==============================
// SLASH COMMAND
// ==============================

const commands = [
    new SlashCommandBuilder()
        .setName("transfer")
        .setDescription("העתקת מבנה של שרת לשרת הנוכחי")
        .addStringOption(option =>
            option
                .setName("server_id")
                .setDescription("ה-ID של שרת המקור")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator.toString()
        )
        .toJSON()
];

// ==============================
// REGISTER COMMAND
// ==============================

async function registerCommands() {
    try {
        const rest = new REST({ version: "10" }).setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands
            }
        );

        console.log("✅ Slash commands registered");
    } catch (error) {
        console.error("❌ Failed to register commands:", error);
    }
}

// ==============================
// READY
// ==============================

client.once(Events.ClientReady, async readyClient => {
    console.log(`✅ Logged in as ${readyClient.user.tag}`);
    console.log(`📡 Servers: ${readyClient.guilds.cache.size}`);

    await registerCommands();
});

// ==============================
// TRANSFER SYSTEM
// ==============================

async function transferServer(sourceGuild, targetGuild) {

    const result = {
        roles: 0,
        categories: 0,
        channels: 0
    };

    console.log(
        `📦 Starting transfer: ${sourceGuild.name} -> ${targetGuild.name}`
    );

    // =====================================
    // 1. COPY ROLES
    // =====================================

    const roleMap = new Map();

    const sourceRoles = [...sourceGuild.roles.cache.values()]
        .filter(role => role.id !== sourceGuild.id)
        .sort((a, b) => a.position - b.position);

    for (const sourceRole of sourceRoles) {

        // Skip managed/integration roles
        if (sourceRole.managed) continue;

        try {

            const existingRole = targetGuild.roles.cache.find(
                role => role.name === sourceRole.name
            );

            if (existingRole) {
                roleMap.set(sourceRole.id, existingRole.id);
                continue;
            }

            const newRole = await targetGuild.roles.create({
                name: sourceRole.name,
                color: sourceRole.color,
                hoist: sourceRole.hoist,
                mentionable: sourceRole.mentionable,
                permissions: sourceRole.permissions,
                reason: "Server transfer"
            });

            roleMap.set(sourceRole.id, newRole.id);

            result.roles++;

        } catch (error) {
            console.error(
                `❌ Failed creating role ${sourceRole.name}:`,
                error.message
            );
        }
    }

    // =====================================
    // 2. COPY CATEGORIES
    // =====================================

    const categoryMap = new Map();

    const sourceCategories = sourceGuild.channels.cache
        .filter(channel =>
            channel.type === ChannelType.GuildCategory
        )
        .sort((a, b) => a.position - b.position);

    for (const category of sourceCategories.values()) {

        try {

            const newCategory = await targetGuild.channels.create({
                name: category.name,
                type: ChannelType.GuildCategory,
                position: category.position
            });

            categoryMap.set(category.id, newCategory.id);

            // Copy permission overwrites
            await copyPermissionOverwrites(
                category,
                newCategory,
                roleMap,
                sourceGuild,
                targetGuild
            );

            result.categories++;

        } catch (error) {
            console.error(
                `❌ Failed creating category ${category.name}:`,
                error.message
            );
        }
    }

    // =====================================
    // 3. COPY CHANNELS
    // =====================================

    const sourceChannels = sourceGuild.channels.cache
        .filter(channel =>
            channel.type !== ChannelType.GuildCategory
        )
        .sort((a, b) => a.position - b.position);

    for (const channel of sourceChannels.values()) {

        try {

            let newChannel;

            const parentId =
                channel.parentId
                    ? categoryMap.get(channel.parentId)
                    : null;

            const options = {
                name: channel.name,
                type: channel.type,
                position: channel.position,
                reason: "Server transfer"
            };

            // Text channel
            if (channel.type === ChannelType.GuildText) {

                options.topic = channel.topic || undefined;
                options.nsfw = channel.nsfw;
                options.rateLimitPerUser =
                    channel.rateLimitPerUser || 0;

                if (parentId) {
                    options.parent = parentId;
                }

            }

            // Voice channel
            else if (channel.type === ChannelType.GuildVoice) {

                options.bitrate = channel.bitrate;
                options.userLimit = channel.userLimit;

                if (parentId) {
                    options.parent = parentId;
                }

            }

            // Announcement channel
            else if (channel.type === ChannelType.GuildAnnouncement) {

                options.topic = channel.topic || undefined;
                options.nsfw = channel.nsfw;

                if (parentId) {
                    options.parent = parentId;
                }

            }

            // Stage channel
            else if (channel.type === ChannelType.GuildStageVoice) {

                if (parentId) {
                    options.parent = parentId;
                }

            }

            // Forum
            else if (channel.type === ChannelType.GuildForum) {

                options.topic = channel.topic || undefined;
                options.nsfw = channel.nsfw;

                if (parentId) {
                    options.parent = parentId;
                }

            }

            // Skip unsupported channel types
            else {
                console.log(
                    `⚠️ Skipping unsupported channel: ${channel.name}`
                );
                continue;
            }

            newChannel = await targetGuild.channels.create(options);

            // Copy permission overwrites
            await copyPermissionOverwrites(
                channel,
                newChannel,
                roleMap,
                sourceGuild,
                targetGuild
            );

            result.channels++;

        } catch (error) {

            console.error(
                `❌ Failed creating channel ${channel.name}:`,
                error.message
            );

        }
    }

    return result;
}

// ==============================
// COPY PERMISSIONS
// ==============================

async function copyPermissionOverwrites(
    sourceChannel,
    targetChannel,
    roleMap,
    sourceGuild,
    targetGuild
) {

    const overwrites = [];

    for (const overwrite of sourceChannel.permissionOverwrites.cache.values()) {

        let targetId = null;

        // Role
        if (overwrite.type === 0) {

            // @everyone
            if (overwrite.id === sourceGuild.id) {
                targetId = targetGuild.id;
            } else {
                targetId = roleMap.get(overwrite.id);
            }

        }

        // Member
        else if (overwrite.type === 1) {

            // We cannot copy permissions for users
            // who are not necessarily members of target server.
            continue;
        }

        if (!targetId) continue;

        overwrites.push({
            id: targetId,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString(),
            type: overwrite.type
        });
    }

    if (overwrites.length > 0) {

        try {

            await targetChannel.permissionOverwrites.set(
                overwrites,
                "Server transfer"
            );

        } catch (error) {

            console.error(
                `⚠️ Permission copy failed for ${sourceChannel.name}:`,
                error.message
            );

        }
    }
}

// ==============================
// INTERACTIONS
// ==============================

client.on(Events.InteractionCreate, async interaction => {

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName !== "transfer") return;

    // =====================================
    // MUST BE IN A SERVER
    // =====================================

    if (!interaction.guild) {

        return interaction.reply({
            content: "❌ אפשר להשתמש בפקודה רק בתוך שרת.",
            ephemeral: true
        });

    }

    // =====================================
    // ADMIN CHECK
    // =====================================

    if (
        !interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
        )
    ) {

        return interaction.reply({
            content: "❌ אתה חייב להיות Administrator כדי להשתמש בפקודה הזאת.",
            ephemeral: true
        });

    }

    // =====================================
    // SOURCE SERVER
    // =====================================

    const sourceId =
        interaction.options.getString("server_id");

    let sourceGuild;

    try {

        sourceGuild =
            await client.guilds.fetch(sourceId);

    } catch {

        return interaction.reply({
            content:
                "❌ הבוט לא נמצא בשרת המקור.\n\n" +
                "ודא שהבוט נמצא גם בשרת שאתה רוצה להעתיק ממנו.",
            ephemeral: true
        });

    }

    const targetGuild = interaction.guild;

    // =====================================
    // SAME SERVER
    // =====================================

    if (sourceGuild.id === targetGuild.id) {

        return interaction.reply({
            content:
                "❌ אי אפשר להעתיק שרת אל עצמו.",
            ephemeral: true
        });

    }

    // =====================================
    // FETCH MEMBERS / CHANNELS / ROLES
    // =====================================

    try {
        await sourceGuild.channels.fetch();
        await sourceGuild.roles.fetch();

        await targetGuild.channels.fetch();
        await targetGuild.roles.fetch();

    } catch (error) {

        console.error(error);

        return interaction.reply({
            content:
                "❌ הייתה בעיה בטעינת נתוני השרתים.",
            ephemeral: true
        });

    }

    // =====================================
    // CONFIRMATION
    // =====================================

    const confirmButton = new ButtonBuilder()
        .setCustomId(`transfer_confirm_${interaction.user.id}`)
        .setLabel("כן, התחל העברה")
        .setStyle(ButtonStyle.Success);

    const cancelButton = new ButtonBuilder()
        .setCustomId(`transfer_cancel_${interaction.user.id}`)
        .setLabel("ביטול")
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
        .addComponents(
            confirmButton,
            cancelButton
        );

    await interaction.reply({
        content:
            `⚠️ **אישור העברת שרת**\n\n` +
            `📥 מקור: **${sourceGuild.name}**\n` +
            `📤 יעד: **${targetGuild.name}**\n\n` +
            `הבוט ייצור בשרת היעד:\n` +
            `• תפקידים\n` +
            `• קטגוריות\n` +
            `• ערוצים\n` +
            `• הרשאות ערוצים\n\n` +
            `⚠️ ההעברה לא מוחקת את שרת המקור.\n\n` +
            `לחץ על **כן, התחל העברה** כדי להתחיל.`,
        components: [row],
        ephemeral: true
    });
});

// ==============================
// BUTTONS
// ==============================

client.on(Events.InteractionCreate, async interaction => {

    if (!interaction.isButton()) return;

    const customId = interaction.customId;

    if (
        !customId.startsWith("transfer_confirm_") &&
        !customId.startsWith("transfer_cancel_")
    ) {
        return;
    }

    const userId = customId.split("_").pop();

    if (interaction.user.id !== userId) {

        return interaction.reply({
            content:
                "❌ רק מי שהפעיל את ההעברה יכול להשתמש בכפתור הזה.",
            ephemeral: true
        });

    }

    // =====================================
    // CANCEL
    // =====================================

    if (customId.startsWith("transfer_cancel_")) {

        return interaction.update({
            content: "❌ ההעברה בוטלה.",
            components: []
        });

    }

    // =====================================
    // CONFIRM
    // =====================================

    await interaction.update({
        content:
            "⏳ **מתחיל להעתיק את השרת...**\n\n" +
            "זה יכול לקחת קצת זמן אם יש הרבה ערוצים ותפקידים.",
        components: []
    });

    const targetGuild = interaction.guild;

    // Extract source ID from interaction message isn't stored,
    // so we recover it from the command interaction metadata.
    // The source guild is found by reading the original command
    // interaction from the command options isn't possible here.
    //
    // Therefore we store pending transfers globally.

    const pending = pendingTransfers.get(interaction.user.id);

    if (!pending) {

        return interaction.followUp({
            content:
                "❌ פג תוקף ההעברה. הפעל שוב `/transfer`.",
            ephemeral: true
        });

    }

    pendingTransfers.delete(interaction.user.id);

    let sourceGuild;

    try {

        sourceGuild =
            await client.guilds.fetch(pending.sourceId);

    } catch {

        return interaction.followUp({
            content:
                "❌ לא הצלחתי לגשת לשרת המקור.",
            ephemeral: true
        });

    }

    try {

        const result =
            await transferServer(
                sourceGuild,
                targetGuild
            );

        await interaction.followUp({
            content:
                `✅ **ההעברה הסתיימה!**\n\n` +
                `📥 מקור: **${sourceGuild.name}**\n` +
                `📤 יעד: **${targetGuild.name}**\n\n` +
                `🎭 תפקידים: **${result.roles}**\n` +
                `📁 קטגוריות: **${result.categories}**\n` +
                `💬 ערוצים: **${result.channels}**\n\n` +
                `⚠️ חברים, הודעות וקבצים ישנים לא מועתקים.`,
            ephemeral: true
        });

    } catch (error) {

        console.error(error);

        await interaction.followUp({
            content:
                "❌ ההעברה נכשלה. בדוק שלבוט יש Administrator בשני השרתים.",
            ephemeral: true
        });

    }

});

// ==============================
// PENDING TRANSFERS
// ==============================

const pendingTransfers = new Map();

// We need to save the source ID when /transfer is used.
// Add a second listener specifically for the command.

client.on(Events.InteractionCreate, async interaction => {

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName !== "transfer") return;

    const sourceId =
        interaction.options.getString("server_id");

    pendingTransfers.set(
        interaction.user.id,
        {
            sourceId,
            createdAt: Date.now()
        }
    );

    // Automatically remove after 5 minutes
    setTimeout(() => {

        const pending =
            pendingTransfers.get(interaction.user.id);

        if (
            pending &&
            pending.sourceId === sourceId
        ) {
            pendingTransfers.delete(
                interaction.user.id
            );
        }

    }, 5 * 60 * 1000);

});

// ==============================
// LOGIN
// ==============================

client.login(TOKEN);
