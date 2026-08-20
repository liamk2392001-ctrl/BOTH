const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events
} = require("discord.js");

const express = require("express");

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
    console.log("❌ DISCORD_TOKEN לא מוגדר");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.log("❌ CLIENT_ID לא מוגדר");
    process.exit(1);
}

// ======================================================
// CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ======================================================
// RENDER SERVER
// ======================================================

const app = express();

app.get("/", (req, res) => {
    res.send("Discord Transfer Bot Online");
});

app.get("/health", (req, res) => {
    res.json({
        online: true,
        bot: client.user ? client.user.tag : null
    });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});

// ======================================================
// COMMAND
// ======================================================

const commands = [
    new SlashCommandBuilder()
        .setName("transfer")
        .setDescription("העתקת מבנה שרת")
        .addStringOption(option =>
            option
                .setName("server_id")
                .setDescription("ID של שרת המקור")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator.toString()
        )
        .toJSON()
];

// ======================================================
// REGISTER COMMAND
// ======================================================

async function registerCommands() {

    try {

        const rest = new REST({
            version: "10"
        }).setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands
            }
        );

        console.log("✅ /transfer registered");

    } catch (error) {

        console.error(
            "❌ Command registration failed:",
            error
        );
    }
}

// ======================================================
// READY
// ======================================================

client.once(Events.ClientReady, async () => {

    console.log("================================");
    console.log(`🤖 Bot: ${client.user.tag}`);
    console.log(`📡 Servers: ${client.guilds.cache.size}`);
    console.log("================================");

    await registerCommands();
});

// ======================================================
// GET SOURCE SERVER
// ======================================================

async function getSourceGuild(id) {

    try {

        // Try cache first
        let guild = client.guilds.cache.get(id);

        // If not cached, fetch it
        if (!guild) {
            guild = await client.guilds.fetch(id);
        }

        if (!guild) {
            return null;
        }

        // IMPORTANT:
        // Force fresh data
        await guild.fetch();

        // Fetch roles
        await guild.roles.fetch();

        // Fetch channels
        await guild.channels.fetch();

        return guild;

    } catch (error) {

        console.error(
            "SOURCE FETCH ERROR:",
            error.message
        );

        return null;
    }
}

// ======================================================
// COPY ROLE PERMISSIONS
// ======================================================

function translateOverwrites(
    sourceChannel,
    targetGuild,
    roleMap,
    sourceGuild
) {

    const overwrites = [];

    for (const overwrite of sourceChannel.permissionOverwrites.cache.values()) {

        let newId = null;

        // ROLE
        if (overwrite.type === 0) {

            // @everyone
            if (overwrite.id === sourceGuild.id) {

                newId = targetGuild.id;

            } else {

                newId = roleMap.get(overwrite.id);
            }
        }

        // USER PERMISSIONS
        // We intentionally skip these because
        // users may not exist in the destination server.
        if (overwrite.type === 1) {
            continue;
        }

        if (!newId) {
            continue;
        }

        overwrites.push({
            id: newId,
            type: 0,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString()
        });
    }

    return overwrites;
}

// ======================================================
// TRANSFER SERVER
// ======================================================

async function transferServer(sourceGuild, targetGuild) {

    let roleCount = 0;
    let categoryCount = 0;
    let channelCount = 0;

    // ==================================================
    // FETCH EVERYTHING AGAIN
    // ==================================================

    await sourceGuild.fetch();
    await sourceGuild.roles.fetch();
    await sourceGuild.channels.fetch();

    await targetGuild.fetch();
    await targetGuild.roles.fetch();
    await targetGuild.channels.fetch();

    // ==================================================
    // ROLE MAP
    // ==================================================

    const roleMap = new Map();

    // @everyone
    roleMap.set(
        sourceGuild.id,
        targetGuild.id
    );

    // ==================================================
    // ROLES
    // ==================================================

    const sourceRoles = Array.from(
        sourceGuild.roles.cache.values()
    )
        .filter(role => !role.managed)
        .filter(role => role.id !== sourceGuild.id)
        .sort((a, b) => a.position - b.position);

    console.log(
        `🎭 Source roles: ${sourceRoles.length}`
    );

    for (const sourceRole of sourceRoles) {

        try {

            // Check if already exists
            let targetRole =
                targetGuild.roles.cache.find(
                    role =>
                        role.name === sourceRole.name &&
                        !role.managed
                );

            if (!targetRole) {

                targetRole =
                    await targetGuild.roles.create({

                        name: sourceRole.name,

                        color: sourceRole.color,

                        hoist: sourceRole.hoist,

                        mentionable:
                            sourceRole.mentionable,

                        permissions:
                            sourceRole.permissions,

                        reason:
                            "Discord Server Transfer"
                    });

                roleCount++;

                console.log(
                    `✅ Created role: ${sourceRole.name}`
                );

            } else {

                console.log(
                    `↪️ Existing role: ${sourceRole.name}`
                );
            }

            roleMap.set(
                sourceRole.id,
                targetRole.id
            );

        } catch (error) {

            console.log(
                `❌ Role failed ${sourceRole.name}: ${error.message}`
            );
        }
    }

    // ==================================================
    // CATEGORIES
    // ==================================================

    const categoryMap = new Map();

    const sourceCategories =
        Array.from(
            sourceGuild.channels.cache.values()
        )
        .filter(channel =>
            channel.type === ChannelType.GuildCategory
        )
        .sort(
            (a, b) =>
                a.position - b.position
        );

    console.log(
        `📁 Source categories: ${sourceCategories.length}`
    );

    for (const category of sourceCategories) {

        try {

            const newCategory =
                await targetGuild.channels.create({

                    name: category.name,

                    type:
                        ChannelType.GuildCategory,

                    reason:
                        "Discord Server Transfer"
                });

            categoryMap.set(
                category.id,
                newCategory.id
            );

            // Permissions
            const overwrites =
                translateOverwrites(
                    category,
                    targetGuild,
                    roleMap,
                    sourceGuild
                );

            if (overwrites.length > 0) {

                await newCategory
                    .permissionOverwrites
                    .set(
                        overwrites,
                        "Discord Server Transfer"
                    );
            }

            categoryCount++;

            console.log(
                `✅ Created category: ${category.name}`
            );

        } catch (error) {

            console.log(
                `❌ Category failed ${category.name}: ${error.message}`
            );
        }
    }

    // ==================================================
    // CHANNELS
    // ==================================================

    const sourceChannels =
        Array.from(
            sourceGuild.channels.cache.values()
        )
        .filter(channel =>
            channel.type !==
            ChannelType.GuildCategory
        )
        .sort(
            (a, b) =>
                a.position - b.position
        );

    console.log(
        `💬 Source channels: ${sourceChannels.length}`
    );

    for (const channel of sourceChannels) {

        try {

            // ==========================================
            // SUPPORTED TYPES
            // ==========================================

            const supported = [

                ChannelType.GuildText,

                ChannelType.GuildVoice,

                ChannelType.GuildAnnouncement,

                ChannelType.GuildStageVoice,

                ChannelType.GuildForum
            ];

            if (!supported.includes(channel.type)) {

                console.log(
                    `⚠️ Skipped unsupported: ${channel.name}`
                );

                continue;
            }

            // ==========================================
            // OPTIONS
            // ==========================================

            const options = {

                name: channel.name,

                type: channel.type,

                reason:
                    "Discord Server Transfer"
            };

            // ==========================================
            // CATEGORY
            // ==========================================

            if (channel.parentId) {

                const newParent =
                    categoryMap.get(
                        channel.parentId
                    );

                if (newParent) {

                    options.parent =
                        newParent;
                }
            }

            // ==========================================
            // TEXT
            // ==========================================

            if (
                channel.type ===
                ChannelType.GuildText
            ) {

                if (channel.topic) {
                    options.topic =
                        channel.topic;
                }

                options.nsfw =
                    channel.nsfw;

                options.rateLimitPerUser =
                    channel.rateLimitPerUser;
            }

            // ==========================================
            // ANNOUNCEMENT
            // ==========================================

            if (
                channel.type ===
                ChannelType.GuildAnnouncement
            ) {

                if (channel.topic) {
                    options.topic =
                        channel.topic;
                }

                options.nsfw =
                    channel.nsfw;
            }

            // ==========================================
            // VOICE
            // ==========================================

            if (
                channel.type ===
                ChannelType.GuildVoice
            ) {

                options.bitrate =
                    channel.bitrate;

                options.userLimit =
                    channel.userLimit;
            }

            // ==========================================
            // FORUM
            // ==========================================

            if (
                channel.type ===
                ChannelType.GuildForum
            ) {

                if (channel.topic) {
                    options.topic =
                        channel.topic;
                }

                options.nsfw =
                    channel.nsfw;
            }

            // ==========================================
            // CREATE
            // ==========================================

            const newChannel =
                await targetGuild.channels.create(
                    options
                );

            // ==========================================
            // PERMISSIONS
            // ==========================================

            const overwrites =
                translateOverwrites(
                    channel,
                    targetGuild,
                    roleMap,
                    sourceGuild
                );

            if (overwrites.length > 0) {

                await newChannel
                    .permissionOverwrites
                    .set(
                        overwrites,
                        "Discord Server Transfer"
                    );
            }

            channelCount++;

            console.log(
                `✅ Created channel: ${channel.name}`
            );

        } catch (error) {

            console.log(
                `❌ Channel failed ${channel.name}: ${error.message}`
            );
        }
    }

    // ==================================================
    // RETURN
    // ==================================================

    return {
        roles: roleCount,
        categories: categoryCount,
        channels: channelCount
    };
}

// ======================================================
// INTERACTION
// ======================================================

client.on(
    Events.InteractionCreate,
    async interaction => {

        if (!interaction.isChatInputCommand()) {
            return;
        }

        if (
            interaction.commandName !==
            "transfer"
        ) {
            return;
        }

        // ==================================================
        // ADMIN CHECK
        // ==================================================

        if (
            !interaction.member.permissions.has(
                PermissionFlagsBits.Administrator
            )
        ) {

            return interaction.reply({

                content:
                    "❌ אתה חייב Administrator.",

                ephemeral: true
            });
        }

        const sourceId =
            interaction.options.getString(
                "server_id"
            );

        const targetGuild =
            interaction.guild;

        // ==================================================
        // SAME SERVER
        // ==================================================

        if (
            sourceId ===
            targetGuild.id
        ) {

            return interaction.reply({

                content:
                    "❌ אי אפשר להעתיק שרת לעצמו.",

                ephemeral: true
            });
        }

        // ==================================================
        // LOADING
        // ==================================================

        await interaction.deferReply({
            ephemeral: true
        });

        // ==================================================
        // SOURCE
        // ==================================================

        const sourceGuild =
            await getSourceGuild(
                sourceId
            );

        if (!sourceGuild) {

            return interaction.editReply({

                content:
                    "❌ הבוט לא נמצא בשרת המקור, או שה-ID שגוי.\n\n" +
                    "ודא שהבוט נמצא בשני השרתים ונסה שוב."
            });
        }

        // ==================================================
        // TARGET
        // ==================================================

        try {

            await targetGuild.fetch();

            await targetGuild.roles.fetch();

            await targetGuild.channels.fetch();

        } catch (error) {

            return interaction.editReply({

                content:
                    "❌ לא הצלחתי לגשת לשרת היעד."
            });
        }

        // ==================================================
        // COUNT
        // ==================================================

        const roles =
            Math.max(
                0,
                sourceGuild.roles.cache.size - 1
            );

        const categories =
            sourceGuild.channels.cache.filter(
                c =>
                    c.type ===
                    ChannelType.GuildCategory
            ).size;

        const channels =
            sourceGuild.channels.cache.filter(
                c =>
                    c.type !==
                    ChannelType.GuildCategory
            ).size;

        // ==================================================
        // CONFIRM
        // ==================================================

        const yes =
            new ButtonBuilder()

                .setCustomId(
                    `transfer_yes_${interaction.user.id}`
                )

                .setLabel(
                    "התחל העברה"
                )

                .setStyle(
                    ButtonStyle.Success
                );

        const no =
            new ButtonBuilder()

                .setCustomId(
                    `transfer_no_${interaction.user.id}`
                )

                .setLabel(
                    "ביטול"
                )

                .setStyle(
                    ButtonStyle.Danger
                );

        const row =
            new ActionRowBuilder()
                .addComponents(
                    yes,
                    no
                );

        // Save transfer
        pending.set(
            interaction.user.id,
            {
                sourceId: sourceGuild.id,
                targetId: targetGuild.id
            }
        );

        await interaction.editReply({

            content:

                `⚠️ **אישור העברה**\n\n` +

                `📥 מקור: **${sourceGuild.name}**\n` +

                `📤 יעד: **${targetGuild.name}**\n\n` +

                `🎭 תפקידים: **${roles}**\n` +

                `📁 קטגוריות: **${categories}**\n` +

                `💬 ערוצים: **${channels}**\n\n` +

                `לחץ על **התחל העברה** כדי להתחיל.`,

            components: [
                row
            ]
        });
    }
);

// ======================================================
// PENDING
// ======================================================

const pending =
    new Map();

// ======================================================
// BUTTONS
// ======================================================

client.on(
    Events.InteractionCreate,
    async interaction => {

        if (!interaction.isButton()) {
            return;
        }

        if (
            !interaction.customId.startsWith(
                "transfer_"
            )
        ) {
            return;
        }

        const userId =
            interaction.customId.split(
                "_"
            ).pop();

        if (
            interaction.user.id !==
            userId
        ) {

            return interaction.reply({

                content:
                    "❌ רק מי שהפעיל את הפקודה יכול להשתמש בכפתור.",

                ephemeral: true
            });
        }

        const data =
            pending.get(userId);

        if (!data) {

            return interaction.update({

                content:
                    "❌ פג תוקף ההעברה. הפעל `/transfer` מחדש.",

                components: []
            });
        }

        // ==================================================
        // CANCEL
        // ==================================================

        if (
            interaction.customId.startsWith(
                "transfer_no_"
            )
        ) {

            pending.delete(userId);

            return interaction.update({

                content:
                    "❌ **ההעברה בוטלה.**",

                components: []
            });
        }

        // ==================================================
        // START
        // ==================================================

        await interaction.update({

            content:
                "⏳ **מתחיל להעתיק את השרת...**\n\n" +
                "זה יכול לקחת זמן אם יש הרבה ערוצים ותפקידים.",

            components: []
        });

        try {

            const sourceGuild =
                await getSourceGuild(
                    data.sourceId
                );

            const targetGuild =
                await client.guilds.fetch(
                    data.targetId
                );

            if (!sourceGuild) {
                throw new Error(
                    "Source server unavailable"
                );
            }

            await targetGuild.fetch();

            await targetGuild.roles.fetch();

            await targetGuild.channels.fetch();

            // ==================================================
            // TRANSFER
            // ==================================================

            const result =
                await transferServer(
                    sourceGuild,
                    targetGuild
                );

            pending.delete(userId);

            await interaction.followUp({

                content:

                    `# ✅ ההעברה הסתיימה!\n\n` +

                    `📥 מקור: **${sourceGuild.name}**\n` +

                    `📤 יעד: **${targetGuild.name}**\n\n` +

                    `🎭 תפקידים שנוצרו: **${result.roles}**\n` +

                    `📁 קטגוריות שנוצרו: **${result.categories}**\n` +

                    `💬 ערוצים שנוצרו: **${result.channels}**\n\n` +

                    `⚠️ הודעות ישנות, חברים וקבצים לא מועתקים.`,

                ephemeral: true
            });

        } catch (error) {

            console.error(
                "TRANSFER ERROR:",
                error
            );

            pending.delete(userId);

            await interaction.followUp({

                content:

                    `❌ **ההעברה נכשלה.**\n\n` +

                    `הסיבה: \`${error.message}\`\n\n` +

                    `ודא שלבוט יש Administrator בשני השרתים.`,

                ephemeral: true
            });
        }
    }
);

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
