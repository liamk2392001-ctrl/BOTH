const {
    Client,
    GatewayIntentBits,
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

// ==========================================
// CONFIG
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN לא מוגדר");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("❌ CLIENT_ID לא מוגדר");
    process.exit(1);
}

// ==========================================
// CLIENT
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ==========================================
// RENDER WEB SERVER
// ==========================================

const app = express();

app.get("/", (req, res) => {
    res.send("Discord Transfer Bot is online!");
});

app.get("/health", (req, res) => {
    res.json({
        online: true,
        bot: client.user?.tag || null
    });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// ==========================================
// PENDING TRANSFERS
// ==========================================

const pendingTransfers = new Map();

// ==========================================
// SLASH COMMAND
// ==========================================

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

// ==========================================
// REGISTER COMMAND
// ==========================================

async function registerCommands() {
    try {
        const rest = new REST({ version: "10" }).setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands
            }
        );

        console.log("✅ /transfer registered");
    } catch (error) {
        console.error("❌ Command registration error:", error);
    }
}

// ==========================================
// READY
// ==========================================

client.once(Events.ClientReady, async readyClient => {

    console.log("====================================");
    console.log(`🤖 Logged in as ${readyClient.user.tag}`);
    console.log(`📡 Servers: ${readyClient.guilds.cache.size}`);
    console.log("====================================");

    for (const guild of readyClient.guilds.cache.values()) {
        console.log(`📌 ${guild.name} | ${guild.id}`);
    }

    await registerCommands();
});

// ==========================================
// GET FULL GUILD DATA
// ==========================================

async function loadGuild(guildId) {

    console.log(`🔎 Loading guild: ${guildId}`);

    let guild;

    try {
        guild = await client.guilds.fetch(guildId);
    } catch (error) {
        console.error("❌ Could not fetch guild:", error.message);
        return null;
    }

    if (!guild) {
        return null;
    }

    console.log(`✅ Found guild: ${guild.name}`);

    // Force fetch roles
    let roles;

    try {
        roles = await guild.roles.fetch();
        console.log(`🎭 Roles found: ${roles.size}`);
    } catch (error) {
        console.error("❌ Roles fetch failed:", error.message);
        roles = new Map();
    }

    // Force fetch channels
    let channels;

    try {
        channels = await guild.channels.fetch();
        console.log(`📁 Channels found: ${channels.size}`);
    } catch (error) {
        console.error("❌ Channels fetch failed:", error.message);
        channels = new Map();
    }

    return {
        guild,
        roles,
        channels
    };
}

// ==========================================
// COPY PERMISSION OVERWRITES
// ==========================================

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

        // ROLE
        if (overwrite.type === 0) {

            // @everyone
            if (overwrite.id === sourceGuild.id) {
                targetId = targetGuild.id;
            } else {
                targetId = roleMap.get(overwrite.id);
            }
        }

        // MEMBER
        // We skip member permissions because the same
        // users may not exist in the target server.
        if (overwrite.type === 1) {
            continue;
        }

        if (!targetId) {
            continue;
        }

        overwrites.push({
            id: targetId,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString(),
            type: 0
        });
    }

    if (overwrites.length === 0) {
        return;
    }

    try {

        await targetChannel.permissionOverwrites.set(
            overwrites,
            "Server transfer"
        );

        console.log(
            `🔐 Permissions copied: ${sourceChannel.name}`
        );

    } catch (error) {

        console.error(
            `⚠️ Permission error ${sourceChannel.name}:`,
            error.message
        );
    }
}

// ==========================================
// TRANSFER SERVER
// ==========================================

async function transferServer(sourceData, targetData) {

    const sourceGuild = sourceData.guild;
    const targetGuild = targetData.guild;

    const sourceRoles = sourceData.roles;
    const sourceChannels = sourceData.channels;

    const result = {
        roles: 0,
        categories: 0,
        channels: 0
    };

    console.log("");
    console.log("====================================");
    console.log("🚀 STARTING TRANSFER");
    console.log(`📥 SOURCE: ${sourceGuild.name}`);
    console.log(`📤 TARGET: ${targetGuild.name}`);
    console.log("====================================");

    // ==========================================
    // ROLE MAP
    // ==========================================

    const roleMap = new Map();

    // Discord's @everyone role
    roleMap.set(
        sourceGuild.id,
        targetGuild.id
    );

    // Get normal roles
    const normalRoles = [...sourceRoles.values()]
        .filter(role => !role.managed)
        .filter(role => role.id !== sourceGuild.id)
        .sort((a, b) => a.position - b.position);

    console.log(`🎭 Copying ${normalRoles.length} roles...`);

    for (const sourceRole of normalRoles) {

        try {

            // Look for an existing role with same name
            let targetRole = targetGuild.roles.cache.find(
                role =>
                    role.name === sourceRole.name &&
                    !role.managed
            );

            if (!targetRole) {

                targetRole = await targetGuild.roles.create({
                    name: sourceRole.name,
                    color: sourceRole.color,
                    hoist: sourceRole.hoist,
                    mentionable: sourceRole.mentionable,
                    permissions: sourceRole.permissions,
                    reason: "Discord server transfer"
                });

                result.roles++;

                console.log(`✅ Role created: ${sourceRole.name}`);

            } else {

                console.log(
                    `↪️ Role already exists: ${sourceRole.name}`
                );
            }

            roleMap.set(
                sourceRole.id,
                targetRole.id
            );

        } catch (error) {

            console.error(
                `❌ Role failed: ${sourceRole.name}`,
                error.message
            );
        }
    }

    // ==========================================
    // CATEGORIES
    // ==========================================

    const categoryMap = new Map();

    const categories = [...sourceChannels.values()]
        .filter(channel =>
            channel &&
            channel.type === ChannelType.GuildCategory
        )
        .sort((a, b) => a.position - b.position);

    console.log(`📁 Copying ${categories.length} categories...`);

    for (const sourceCategory of categories) {

        try {

            const targetCategory =
                await targetGuild.channels.create({
                    name: sourceCategory.name,
                    type: ChannelType.GuildCategory,
                    reason: "Discord server transfer"
                });

            categoryMap.set(
                sourceCategory.id,
                targetCategory.id
            );

            await copyPermissionOverwrites(
                sourceCategory,
                targetCategory,
                roleMap,
                sourceGuild,
                targetGuild
            );

            result.categories++;

            console.log(
                `✅ Category created: ${sourceCategory.name}`
            );

        } catch (error) {

            console.error(
                `❌ Category failed: ${sourceCategory.name}`,
                error.message
            );
        }
    }

    // ==========================================
    // CHANNELS
    // ==========================================

    const channels = [...sourceChannels.values()]
        .filter(channel =>
            channel &&
            channel.type !== ChannelType.GuildCategory
        )
        .sort((a, b) => a.position - b.position);

    console.log(`💬 Copying ${channels.length} channels...`);

    for (const sourceChannel of channels) {

        try {

            const options = {
                name: sourceChannel.name,
                type: sourceChannel.type,
                reason: "Discord server transfer"
            };

            // ==================================
            // CATEGORY
            // ==================================

            if (sourceChannel.parentId) {

                const newParent =
                    categoryMap.get(sourceChannel.parentId);

                if (newParent) {
                    options.parent = newParent;
                }
            }

            // ==================================
            // TEXT
            // ==================================

            if (
                sourceChannel.type ===
                ChannelType.GuildText
            ) {

                options.topic =
                    sourceChannel.topic || undefined;

                options.nsfw =
                    sourceChannel.nsfw;

                options.rateLimitPerUser =
                    sourceChannel.rateLimitPerUser || 0;
            }

            // ==================================
            // ANNOUNCEMENT
            // ==================================

            if (
                sourceChannel.type ===
                ChannelType.GuildAnnouncement
            ) {

                options.topic =
                    sourceChannel.topic || undefined;

                options.nsfw =
                    sourceChannel.nsfw;
            }

            // ==================================
            // VOICE
            // ==================================

            if (
                sourceChannel.type ===
                ChannelType.GuildVoice
            ) {

                options.bitrate =
                    sourceChannel.bitrate;

                options.userLimit =
                    sourceChannel.userLimit;
            }

            // ==================================
            // STAGE
            // ==================================

            if (
                sourceChannel.type ===
                ChannelType.GuildStageVoice
            ) {
                // No extra options needed
            }

            // ==================================
            // FORUM
            // ==================================

            if (
                sourceChannel.type ===
                ChannelType.GuildForum
            ) {

                options.topic =
                    sourceChannel.topic || undefined;

                options.nsfw =
                    sourceChannel.nsfw;
            }

            // ==================================
            // SUPPORTED CHANNEL TYPES
            // ==================================

            const supportedTypes = [
                ChannelType.GuildText,
                ChannelType.GuildVoice,
                ChannelType.GuildAnnouncement,
                ChannelType.GuildStageVoice,
                ChannelType.GuildForum
            ];

            if (!supportedTypes.includes(sourceChannel.type)) {

                console.log(
                    `⚠️ Skipped unsupported channel: ${sourceChannel.name}`
                );

                continue;
            }

            // ==================================
            // CREATE CHANNEL
            // ==================================

            const targetChannel =
                await targetGuild.channels.create(options);

            // ==================================
            // COPY PERMISSIONS
            // ==================================

            await copyPermissionOverwrites(
                sourceChannel,
                targetChannel,
                roleMap,
                sourceGuild,
                targetGuild
            );

            result.channels++;

            console.log(
                `✅ Channel created: ${sourceChannel.name}`
            );

        } catch (error) {

            console.error(
                `❌ Channel failed: ${sourceChannel.name}`,
                error.message
            );
        }
    }

    // ==========================================
    // FINISH
    // ==========================================

    console.log("");
    console.log("====================================");
    console.log("✅ TRANSFER FINISHED");
    console.log(`🎭 Roles: ${result.roles}`);
    console.log(`📁 Categories: ${result.categories}`);
    console.log(`💬 Channels: ${result.channels}`);
    console.log("====================================");

    return result;
}

// ==========================================
// SLASH COMMAND
// ==========================================

client.on(Events.InteractionCreate, async interaction => {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    if (interaction.commandName !== "transfer") {
        return;
    }

    // ==========================================
    // ADMIN
    // ==========================================

    if (
        !interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
        )
    ) {

        return interaction.reply({
            content:
                "❌ אתה חייב להיות Administrator כדי להשתמש בפקודה.",
            ephemeral: true
        });
    }

    const sourceId =
        interaction.options.getString("server_id");

    const targetGuild =
        interaction.guild;

    // ==========================================
    // SAME SERVER
    // ==========================================

    if (sourceId === targetGuild.id) {

        return interaction.reply({
            content:
                "❌ אי אפשר להעתיק שרת לעצמו.",
            ephemeral: true
        });
    }

    // ==========================================
    // LOAD SOURCE
    // ==========================================

    await interaction.deferReply({
        ephemeral: true
    });

    const sourceData =
        await loadGuild(sourceId);

    if (!sourceData) {

        return interaction.editReply({
            content:
                "❌ לא מצאתי את שרת המקור.\n\n" +
                "ודא שהבוט נמצא בשרת המקור וששלחת ID נכון."
        });
    }

    // ==========================================
    // LOAD TARGET
    // ==========================================

    const targetData =
        await loadGuild(targetGuild.id);

    if (!targetData) {

        return interaction.editReply({
            content:
                "❌ לא הצלחתי לטעון את שרת היעד."
        });
    }

    console.log("");
    console.log("SOURCE DATA:");
    console.log(`Roles: ${sourceData.roles.size}`);
    console.log(`Channels: ${sourceData.channels.size}`);

    // ==========================================
    // SAVE PENDING
    // ==========================================

    pendingTransfers.set(
        interaction.user.id,
        {
            sourceId,
            targetId: targetGuild.id,
            createdAt: Date.now()
        }
    );

    // ==========================================
    // BUTTONS
    // ==========================================

    const confirm =
        new ButtonBuilder()
            .setCustomId(
                `transfer_confirm_${interaction.user.id}`
            )
            .setLabel("כן, התחל העברה")
            .setStyle(ButtonStyle.Success);

    const cancel =
        new ButtonBuilder()
            .setCustomId(
                `transfer_cancel_${interaction.user.id}`
            )
            .setLabel("ביטול")
            .setStyle(ButtonStyle.Danger);

    const row =
        new ActionRowBuilder()
            .addComponents(
                confirm,
                cancel
            );

    await interaction.editReply({

        content:
            `⚠️ **אישור העברת שרת**\n\n` +

            `📥 **מקור:** ${sourceData.guild.name}\n` +
            `📤 **יעד:** ${targetGuild.name}\n\n` +

            `נמצא במקור:\n` +
            `🎭 תפקידים: **${sourceData.roles.size - 1}**\n` +
            `📁 קטגוריות: **${[...sourceData.channels.values()].filter(c => c?.type === ChannelType.GuildCategory).length}**\n` +
            `💬 ערוצים: **${[...sourceData.channels.values()].filter(c => c && c.type !== ChannelType.GuildCategory).length}**\n\n` +

            `הבוט יעתיק את המבנה וההרשאות.\n` +
            `השרת המקורי לא יימחק.\n\n` +

            `לחץ על **כן, התחל העברה** כדי להתחיל.`,

        components: [row]
    });
});

// ==========================================
// BUTTON HANDLER
// ==========================================

client.on(Events.InteractionCreate, async interaction => {

    if (!interaction.isButton()) {
        return;
    }

    const id =
        interaction.customId;

    if (
        !id.startsWith("transfer_confirm_") &&
        !id.startsWith("transfer_cancel_")
    ) {
        return;
    }

    const userId =
        id.split("_").pop();

    if (interaction.user.id !== userId) {

        return interaction.reply({
            content:
                "❌ רק מי שהפעיל את ההעברה יכול להשתמש בכפתור.",
            ephemeral: true
        });
    }

    const pending =
        pendingTransfers.get(userId);

    if (!pending) {

        return interaction.update({
            content:
                "❌ פג תוקף ההעברה. הפעל שוב `/transfer`.",
            components: []
        });
    }

    // ==========================================
    // CANCEL
    // ==========================================

    if (id.startsWith("transfer_cancel_")) {

        pendingTransfers.delete(userId);

        return interaction.update({
            content:
                "❌ **ההעברה בוטלה.**",
            components: []
        });
    }

    // ==========================================
    // START
    // ==========================================

    await interaction.update({
        content:
            "⏳ **מתחיל להעתיק את השרת...**\n\n" +
            "אל תצא מהשרת ואל תפעיל העברה נוספת.",
        components: []
    });

    try {

        const sourceData =
            await loadGuild(pending.sourceId);

        const targetData =
            await loadGuild(pending.targetId);

        if (!sourceData) {
            throw new Error(
                "Could not load source guild"
            );
        }

        if (!targetData) {
            throw new Error(
                "Could not load target guild"
            );
        }

        const result =
            await transferServer(
                sourceData,
                targetData
            );

        pendingTransfers.delete(userId);

        await interaction.followUp({

            content:
                `# ✅ ההעברה הסתיימה!\n\n` +

                `📥 **מקור:** ${sourceData.guild.name}\n` +
                `📤 **יעד:** ${targetData.guild.name}\n\n` +

                `🎭 **תפקידים:** ${result.roles}\n` +
                `📁 **קטגוריות:** ${result.categories}\n` +
                `💬 **ערוצים:** ${result.channels}\n\n` +

                `⚠️ חברים, הודעות ישנות וקבצים לא מועתקים.`,

            ephemeral: true
        });

    } catch (error) {

        console.error(
            "❌ TRANSFER ERROR:",
            error
        );

        pendingTransfers.delete(userId);

        await interaction.followUp({

            content:
                `❌ **ההעברה נכשלה.**\n\n` +
                `שגיאה: \`${error.message}\`\n\n` +
                `ודא שלבוט יש **Administrator** גם בשרת המקור וגם בשרת היעד.`,

            ephemeral: true
        });
    }
});

// ==========================================
// LOGIN
// ==========================================

client.login(TOKEN);
