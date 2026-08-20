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
// EXPRESS / RENDER
// ======================================================

const app = express();

app.get("/", (req, res) => {
    res.send("Discord Transfer Bot Online");
});

app.get("/health", (req, res) => {
    res.json({
        online: true,
        bot: client.user?.tag || null
    });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`🌐 Running on port ${PORT}`);
});

// ======================================================
// REST
// ======================================================

const rest = new REST({
    version: "10"
}).setToken(TOKEN);

// ======================================================
// PENDING
// ======================================================

const pendingTransfers = new Map();

// ======================================================
// COMMAND
// ======================================================

const commands = [
    new SlashCommandBuilder()
        .setName("transfer")
        .setDescription("העתקת מבנה של שרת")
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
// REGISTER
// ======================================================

async function registerCommands() {

    try {

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands
            }
        );

        console.log("✅ Slash command registered");

    } catch (error) {

        console.error(
            "❌ Slash registration error:",
            error
        );
    }
}

// ======================================================
// READY
// ======================================================

client.once(
    Events.ClientReady,
    async () => {

        console.log(
            `🤖 Logged in as ${client.user.tag}`
        );

        console.log(
            `📡 Servers: ${client.guilds.cache.size}`
        );

        await registerCommands();
    }
);

// ======================================================
// GET SOURCE GUILD
// ======================================================

async function getSourceGuild(serverId) {

    try {

        const guild =
            await client.guilds.fetch(serverId);

        return guild;

    } catch (error) {

        console.error(
            "❌ Guild fetch failed:",
            error.message
        );

        return null;
    }
}

// ======================================================
// GET ROLES DIRECTLY FROM DISCORD API
// ======================================================

async function getSourceRoles(serverId) {

    try {

        const roles =
            await rest.get(
                Routes.guildRoles(serverId)
            );

        console.log(
            `🎭 API returned ${roles.length} roles`
        );

        return roles;

    } catch (error) {

        console.error(
            "❌ Roles API error:",
            error.message
        );

        return [];
    }
}

// ======================================================
// GET CHANNELS DIRECTLY FROM DISCORD API
// ======================================================

async function getSourceChannels(serverId) {

    try {

        const channels =
            await rest.get(
                Routes.guildChannels(serverId)
            );

        console.log(
            `💬 API returned ${channels.length} channels`
        );

        return channels;

    } catch (error) {

        console.error(
            "❌ Channels API error:",
            error.message
        );

        return [];
    }
}

// ======================================================
// PERMISSION OVERWRITES
// ======================================================

function convertOverwrites(
    sourceOverwrites,
    roleMap,
    sourceGuildId,
    targetGuildId
) {

    const result = [];

    if (!sourceOverwrites) {
        return result;
    }

    for (
        const overwrite
        of sourceOverwrites
    ) {

        // We only copy role permissions
        if (overwrite.type !== 0) {
            continue;
        }

        let targetId;

        // @everyone
        if (
            overwrite.id ===
            sourceGuildId
        ) {

            targetId =
                targetGuildId;

        } else {

            targetId =
                roleMap.get(
                    overwrite.id
                );
        }

        if (!targetId) {
            continue;
        }

        result.push({

            id: targetId,

            type: 0,

            allow:
                String(
                    overwrite.allow || "0"
                ),

            deny:
                String(
                    overwrite.deny || "0"
                )
        });
    }

    return result;
}

// ======================================================
// TRANSFER
// ======================================================

async function transferServer(
    sourceGuild,
    targetGuild,
    sourceRoles,
    sourceChannels
) {

    let rolesCreated = 0;
    let categoriesCreated = 0;
    let channelsCreated = 0;

    // ==================================================
    // ROLE MAP
    // ==================================================

    const roleMap =
        new Map();

    // @everyone
    roleMap.set(
        sourceGuild.id,
        targetGuild.id
    );

    // ==================================================
    // ROLES
    // ==================================================

    const normalRoles =
        sourceRoles
            .filter(role =>
                role.id !==
                sourceGuild.id
            )
            .filter(role =>
                role.managed !== true
            )
            .sort(
                (a, b) =>
                    a.position -
                    b.position
            );

    for (
        const sourceRole
        of normalRoles
    ) {

        try {

            let targetRole =
                targetGuild.roles.cache.find(
                    role =>
                        role.name ===
                        sourceRole.name
                );

            // Create role if missing
            if (!targetRole) {

                targetRole =
                    await targetGuild.roles.create({

                        name:
                            sourceRole.name,

                        color:
                            sourceRole.color,

                        hoist:
                            sourceRole.hoist,

                        mentionable:
                            sourceRole.mentionable,

                        permissions:
                            BigInt(
                                sourceRole.permissions
                            ),

                        reason:
                            "Discord Server Transfer"
                    });

                rolesCreated++;

            }

            roleMap.set(
                sourceRole.id,
                targetRole.id
            );

        } catch (error) {

            console.log(
                `❌ Role error ${sourceRole.name}: ${error.message}`
            );
        }
    }

    // ==================================================
    // CATEGORIES FIRST
    // ==================================================

    const categoryMap =
        new Map();

    const categories =
        sourceChannels
            .filter(channel =>
                channel.type ===
                4
            )
            .sort(
                (a, b) =>
                    a.position -
                    b.position
            );

    for (
        const sourceCategory
        of categories
    ) {

        try {

            const targetCategory =
                await targetGuild.channels.create({

                    name:
                        sourceCategory.name,

                    type:
                        ChannelType.GuildCategory,

                    reason:
                        "Discord Server Transfer"
                });

            categoryMap.set(
                sourceCategory.id,
                targetCategory.id
            );

            const overwrites =
                convertOverwrites(
                    sourceCategory.permission_overwrites,
                    roleMap,
                    sourceGuild.id,
                    targetGuild.id
                );

            if (overwrites.length) {

                await targetCategory
                    .permissionOverwrites
                    .set(
                        overwrites,
                        "Discord Server Transfer"
                    );
            }

            categoriesCreated++;

        } catch (error) {

            console.log(
                `❌ Category error ${sourceCategory.name}: ${error.message}`
            );
        }
    }

    // ==================================================
    // CHANNELS
    // ==================================================

    const channels =
        sourceChannels
            .filter(channel =>
                channel.type !==
                4
            )
            .sort(
                (a, b) =>
                    a.position -
                    b.position
            );

    for (
        const sourceChannel
        of channels
    ) {

        try {

            // ==========================================
            // SUPPORTED CHANNELS
            // ==========================================

            const supportedTypes = [
                0,  // text
                2,  // voice
                5,  // announcement
                13, // stage
                15  // forum
            ];

            if (
                !supportedTypes.includes(
                    sourceChannel.type
                )
            ) {

                continue;
            }

            const options = {

                name:
                    sourceChannel.name,

                type:
                    sourceChannel.type,

                reason:
                    "Discord Server Transfer"
            };

            // ==========================================
            // PARENT
            // ==========================================

            if (
                sourceChannel.parent_id
            ) {

                const newParent =
                    categoryMap.get(
                        sourceChannel.parent_id
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
                sourceChannel.type ===
                0
            ) {

                if (
                    sourceChannel.topic
                ) {

                    options.topic =
                        sourceChannel.topic;
                }

                options.nsfw =
                    sourceChannel.nsfw || false;

                options.rateLimitPerUser =
                    sourceChannel.rate_limit_per_user || 0;
            }

            // ==========================================
            // ANNOUNCEMENT
            // ==========================================

            if (
                sourceChannel.type ===
                5
            ) {

                if (
                    sourceChannel.topic
                ) {

                    options.topic =
                        sourceChannel.topic;
                }

                options.nsfw =
                    sourceChannel.nsfw || false;
            }

            // ==========================================
            // VOICE
            // ==========================================

            if (
                sourceChannel.type ===
                2
            ) {

                if (
                    sourceChannel.bitrate
                ) {

                    options.bitrate =
                        sourceChannel.bitrate;
                }

                if (
                    sourceChannel.user_limit
                ) {

                    options.userLimit =
                        sourceChannel.user_limit;
                }
            }

            // ==========================================
            // CREATE
            // ==========================================

            const targetChannel =
                await targetGuild.channels.create(
                    options
                );

            // ==========================================
            // PERMISSIONS
            // ==========================================

            const overwrites =
                convertOverwrites(
                    sourceChannel.permission_overwrites,
                    roleMap,
                    sourceGuild.id,
                    targetGuild.id
                );

            if (overwrites.length) {

                await targetChannel
                    .permissionOverwrites
                    .set(
                        overwrites,
                        "Discord Server Transfer"
                    );
            }

            channelsCreated++;

        } catch (error) {

            console.log(
                `❌ Channel error ${sourceChannel.name}: ${error.message}`
            );
        }
    }

    return {

        roles:
            rolesCreated,

        categories:
            categoriesCreated,

        channels:
            channelsCreated
    };
}

// ======================================================
// /TRANSFER
// ======================================================

client.on(
    Events.InteractionCreate,
    async interaction => {

        if (
            !interaction.isChatInputCommand()
        ) {
            return;
        }

        if (
            interaction.commandName !==
            "transfer"
        ) {
            return;
        }

        // ==================================================
        // ADMIN
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
                    "❌ אי אפשר להעביר שרת לעצמו.",

                ephemeral: true
            });
        }

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
                    "❌ הבוט לא נמצא בשרת המקור או שה-ID שגוי."
            });
        }

        // ==================================================
        // DIRECT API
        // ==================================================

        const sourceRoles =
            await getSourceRoles(
                sourceId
            );

        const sourceChannels =
            await getSourceChannels(
                sourceId
            );

        // ==================================================
        // IMPORTANT CHECK
        // ==================================================

        if (
            sourceRoles.length === 0 &&
            sourceChannels.length === 0
        ) {

            return interaction.editReply({

                content:

                    `❌ Discord החזיר 0 נתונים מהשרת.\n\n` +

                    `שרת: **${sourceGuild.name}**\n` +

                    `ID: \`${sourceId}\`\n\n` +

                    `ודא שהבוט נמצא בשרת הזה עם **Administrator**.`
            });
        }

        // ==================================================
        // COUNT
        // ==================================================

        const roleCount =
            sourceRoles.filter(
                role =>
                    role.id !==
                    sourceId &&
                    !role.managed
            ).length;

        const categoryCount =
            sourceChannels.filter(
                channel =>
                    channel.type ===
                    4
            ).length;

        const channelCount =
            sourceChannels.filter(
                channel =>
                    channel.type !==
                    4
            ).length;

        // ==================================================
        // SAVE
        // ==================================================

        pendingTransfers.set(
            interaction.user.id,
            {
                sourceId,
                targetId:
                    targetGuild.id,
                sourceGuild,
                sourceRoles,
                sourceChannels
            }
        );

        // ==================================================
        // BUTTONS
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

        // ==================================================
        // RESPONSE
        // ==================================================

        await interaction.editReply({

            content:

                `# 📦 נמצאו נתוני השרת!\n\n` +

                `📥 **מקור:** ${sourceGuild.name}\n` +

                `📤 **יעד:** ${targetGuild.name}\n\n` +

                `🎭 **תפקידים:** ${roleCount}\n` +

                `📁 **קטגוריות:** ${categoryCount}\n` +

                `💬 **ערוצים:** ${channelCount}\n\n` +

                `לחץ על **התחל העברה** כדי להעתיק את המבנה.`,

            components: [
                row
            ]
        });
    }
);

// ======================================================
// BUTTON HANDLER
// ======================================================

client.on(
    Events.InteractionCreate,
    async interaction => {

        if (
            !interaction.isButton()
        ) {
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
            interaction.customId
                .split("_")
                .pop();

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
            pendingTransfers.get(
                userId
            );

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

            pendingTransfers.delete(
                userId
            );

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
                "⏳ **מעביר את השרת...**\n\n" +
                "יוצר תפקידים, קטגוריות וערוצים...",

            components: []
        });

        try {

            const targetGuild =
                await client.guilds.fetch(
                    data.targetId
                );

            await targetGuild.roles.fetch();

            await targetGuild.channels.fetch();

            const result =
                await transferServer(

                    data.sourceGuild,

                    targetGuild,

                    data.sourceRoles,

                    data.sourceChannels
                );

            pendingTransfers.delete(
                userId
            );

            await interaction.followUp({

                content:

                    `# ✅ ההעברה הסתיימה!\n\n` +

                    `📥 **מקור:** ${data.sourceGuild.name}\n` +

                    `📤 **יעד:** ${targetGuild.name}\n\n` +

                    `🎭 תפקידים שנוצרו: **${result.roles}**\n` +

                    `📁 קטגוריות שנוצרו: **${result.categories}**\n` +

                    `💬 ערוצים שנוצרו: **${result.channels}**\n\n` +

                    `⚠️ הודעות ישנות, חברים וקבצים לא מועתקים.`,

                ephemeral: true
            });

        } catch (error) {

            console.error(
                "❌ TRANSFER ERROR:",
                error
            );

            pendingTransfers.delete(
                userId
            );

            await interaction.followUp({

                content:

                    `❌ **ההעברה נכשלה**\n\n` +

                    `\`${error.message}\``,

                ephemeral: true
            });
        }
    }
);

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
