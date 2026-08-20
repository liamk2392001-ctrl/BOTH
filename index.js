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

// =====================================================
// CONFIG
// =====================================================

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

// =====================================================
// CLIENT
// =====================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// =====================================================
// EXPRESS / RENDER
// =====================================================

const app = express();

app.get("/", (req, res) => {
    res.send("Discord Transfer Bot Online ✅");
});

app.get("/health", (req, res) => {
    res.json({
        online: true,
        bot: client.user
            ? client.user.tag
            : null
    });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});

// =====================================================
// REST
// =====================================================

const rest = new REST({
    version: "10"
}).setToken(TOKEN);

// =====================================================
// PENDING TRANSFERS
// =====================================================

const pendingTransfers = new Map();

// =====================================================
// COMMAND
// =====================================================

const commands = [

    new SlashCommandBuilder()

        .setName("transfer")

        .setDescription(
            "העתקת שרת לשרת הנוכחי"
        )

        .addStringOption(option =>
            option
                .setName("server_id")
                .setDescription(
                    "ID של שרת המקור"
                )
                .setRequired(true)
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator.toString()
        )

        .toJSON()

];

// =====================================================
// REGISTER COMMAND
// =====================================================

async function registerCommands() {

    try {

        await rest.put(
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            "✅ /transfer registered"
        );

    } catch (error) {

        console.error(
            "❌ Command registration error:",
            error
        );
    }
}

// =====================================================
// READY
// =====================================================

client.once(
    Events.ClientReady,
    async () => {

        console.log(
            "================================="
        );

        console.log(
            `🤖 Logged in as ${client.user.tag}`
        );

        console.log(
            `📡 Servers: ${client.guilds.cache.size}`
        );

        console.log(
            "================================="
        );

        await registerCommands();

    }
);

// =====================================================
// GET SOURCE GUILD
// =====================================================

async function getSourceGuild(
    serverId
) {

    try {

        const guild =
            await client.guilds.fetch(
                serverId
            );

        return guild;

    } catch (error) {

        console.error(
            "❌ Could not access source server:",
            error.message
        );

        return null;
    }
}

// =====================================================
// GET ROLES
// =====================================================

async function getSourceRoles(
    serverId
) {

    try {

        const roles =
            await rest.get(
                Routes.guildRoles(
                    serverId
                )
            );

        console.log(
            `🎭 Found ${roles.length} roles`
        );

        return roles;

    } catch (error) {

        console.error(
            "❌ Roles error:",
            error.message
        );

        return [];
    }
}

// =====================================================
// GET CHANNELS
// =====================================================

async function getSourceChannels(
    serverId
) {

    try {

        const channels =
            await rest.get(
                Routes.guildChannels(
                    serverId
                )
            );

        console.log(
            `💬 Found ${channels.length} channels`
        );

        return channels;

    } catch (error) {

        console.error(
            "❌ Channels error:",
            error.message
        );

        return [];
    }
}

// =====================================================
// COPY PERMISSIONS
// =====================================================

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

        // Only copy role permissions
        if (overwrite.type !== 0) {
            continue;
        }

        let targetRoleId;

        // @everyone
        if (
            overwrite.id ===
            sourceGuildId
        ) {

            targetRoleId =
                targetGuildId;

        } else {

            targetRoleId =
                roleMap.get(
                    overwrite.id
                );
        }

        if (!targetRoleId) {
            continue;
        }

        result.push({

            id: targetRoleId,

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

// =====================================================
// TRANSFER SERVER
// =====================================================

async function transferServer(
    sourceGuild,
    targetGuild,
    sourceRoles,
    sourceChannels
) {

    const stats = {

        roles: 0,

        rolesFailed: 0,

        categories: 0,

        categoriesFailed: 0,

        channels: 0,

        channelsFailed: 0,

        name: false,

        icon: false

    };

    // =================================================
    // ROLE MAP
    // =================================================

    const roleMap = new Map();

    roleMap.set(
        sourceGuild.id,
        targetGuild.id
    );

    // =================================================
    // SERVER NAME
    // =================================================

    try {

        await targetGuild.setName(
            sourceGuild.name,
            "Discord Server Transfer"
        );

        stats.name = true;

        console.log(
            `🏷️ Server name copied`
        );

    } catch (error) {

        console.log(
            "❌ Could not copy server name:",
            error.message
        );
    }

    // =================================================
    // SERVER ICON
    // =================================================

    try {

        const icon =
            sourceGuild.iconURL({
                extension: "png",
                size: 1024
            });

        if (icon) {

            await targetGuild.setIcon(
                icon,
                "Discord Server Transfer"
            );

            stats.icon = true;

            console.log(
                "🖼️ Server icon copied"
            );

        } else {

            console.log(
                "ℹ️ Source server has no icon"
            );
        }

    } catch (error) {

        console.log(
            "❌ Could not copy icon:",
            error.message
        );
    }

    // =================================================
    // ROLES
    // =================================================

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

                stats.roles++;

                console.log(
                    `✅ Role created: ${sourceRole.name}`
                );

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

            stats.rolesFailed++;

            console.log(
                `❌ Role failed: ${sourceRole.name} - ${error.message}`
            );
        }
    }

    // =================================================
    // CATEGORIES
    // =================================================

    const categoryMap = new Map();

    const categories =
        sourceChannels

            .filter(channel =>
                channel.type === 4
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

            if (
                overwrites.length > 0
            ) {

                await targetCategory
                    .permissionOverwrites
                    .set(
                        overwrites,
                        "Discord Server Transfer"
                    );
            }

            stats.categories++;

            console.log(
                `✅ Category created: ${sourceCategory.name}`
            );

        } catch (error) {

            stats.categoriesFailed++;

            console.log(
                `❌ Category failed: ${sourceCategory.name} - ${error.message}`
            );
        }
    }

    // =================================================
    // CHANNELS
    // =================================================

    const channels =
        sourceChannels

            .filter(channel =>
                channel.type !== 4
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

            const supportedTypes = [

                0,  // TEXT
                2,  // VOICE
                5,  // ANNOUNCEMENT
                13, // STAGE
                15  // FORUM

            ];

            if (
                !supportedTypes.includes(
                    sourceChannel.type
                )
            ) {

                console.log(
                    `⚠️ Skipping unsupported channel: ${sourceChannel.name}`
                );

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

            // =========================================
            // CATEGORY
            // =========================================

            if (
                sourceChannel.parent_id
            ) {

                const targetParent =
                    categoryMap.get(
                        sourceChannel.parent_id
                    );

                if (targetParent) {

                    options.parent =
                        targetParent;
                }
            }

            // =========================================
            // TEXT
            // =========================================

            if (
                sourceChannel.type === 0
            ) {

                if (
                    sourceChannel.topic
                ) {

                    options.topic =
                        sourceChannel.topic;
                }

                options.nsfw =
                    sourceChannel.nsfw ||
                    false;

                options.rateLimitPerUser =
                    sourceChannel.rate_limit_per_user ||
                    0;
            }

            // =========================================
            // ANNOUNCEMENT
            // =========================================

            if (
                sourceChannel.type === 5
            ) {

                if (
                    sourceChannel.topic
                ) {

                    options.topic =
                        sourceChannel.topic;
                }

                options.nsfw =
                    sourceChannel.nsfw ||
                    false;
            }

            // =========================================
            // VOICE
            // =========================================

            if (
                sourceChannel.type === 2
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

            // =========================================
            // CREATE CHANNEL
            // =========================================

            const targetChannel =
                await targetGuild.channels.create(
                    options
                );

            // =========================================
            // PERMISSIONS
            // =========================================

            const overwrites =
                convertOverwrites(

                    sourceChannel.permission_overwrites,

                    roleMap,

                    sourceGuild.id,

                    targetGuild.id

                );

            if (
                overwrites.length > 0
            ) {

                await targetChannel
                    .permissionOverwrites
                    .set(
                        overwrites,
                        "Discord Server Transfer"
                    );
            }

            stats.channels++;

            console.log(
                `✅ Channel created: ${sourceChannel.name}`
            );

        } catch (error) {

            stats.channelsFailed++;

            console.log(
                `❌ Channel failed: ${sourceChannel.name} - ${error.message}`
            );
        }
    }

    return stats;
}

// =====================================================
// TRANSFER COMMAND
// =====================================================

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

        // =================================================
        // ADMIN CHECK
        // =================================================

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

        // =================================================
        // SAME SERVER
        // =================================================

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

        await interaction.deferReply({
            ephemeral: true
        });

        // =================================================
        // SOURCE
        // =================================================

        const sourceGuild =
            await getSourceGuild(
                sourceId
            );

        if (!sourceGuild) {

            return interaction.editReply({

                content:

                    "❌ לא מצאתי את שרת המקור.\n\n" +

                    "ודא שהבוט נמצא בשרת המקור עם Administrator."

            });
        }

        // =================================================
        // SOURCE DATA
        // =================================================

        const sourceRoles =
            await getSourceRoles(
                sourceId
            );

        const sourceChannels =
            await getSourceChannels(
                sourceId
            );

        if (
            sourceRoles.length === 0 &&
            sourceChannels.length === 0
        ) {

            return interaction.editReply({

                content:

                    "❌ לא נמצאו תפקידים או ערוצים בשרת המקור.\n\n" +

                    `שרת: **${sourceGuild.name}**\n` +

                    `ID: \`${sourceId}\`\n\n` +

                    "ודא שהבוט נמצא בשרת המקור עם Administrator."

            });
        }

        // =================================================
        // COUNT
        // =================================================

        const roleCount =
            sourceRoles.filter(
                role =>
                    role.id !== sourceId &&
                    !role.managed
            ).length;

        const categoryCount =
            sourceChannels.filter(
                channel =>
                    channel.type === 4
            ).length;

        const channelCount =
            sourceChannels.filter(
                channel =>
                    channel.type !== 4
            ).length;

        // =================================================
        // SAVE
        // =================================================

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

        // =================================================
        // BUTTONS
        // =================================================

        const startButton =
            new ButtonBuilder()

                .setCustomId(
                    `transfer_start_${interaction.user.id}`
                )

                .setLabel(
                    "התחל העברה"
                )

                .setStyle(
                    ButtonStyle.Success
                );

        const cancelButton =
            new ButtonBuilder()

                .setCustomId(
                    `transfer_cancel_${interaction.user.id}`
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
                    startButton,
                    cancelButton
                );

        // =================================================
        // RESPONSE
        // =================================================

        await interaction.editReply({

            content:

                `# 📦 העתקת שרת\n\n` +

                `📥 **מקור:** ${sourceGuild.name}\n` +

                `📤 **יעד:** ${targetGuild.name}\n\n` +

                `🏷️ שם השרת: **כן**\n` +

                `🖼️ אייקון: **${sourceGuild.icon ? "כן" : "אין לשרת המקור אייקון"}**\n\n` +

                `🎭 תפקידים: **${roleCount}**\n` +

                `📁 קטגוריות: **${categoryCount}**\n` +

                `💬 ערוצים: **${channelCount}**\n\n` +

                `⚠️ הודעות ישנות וחברי השרת לא מועתקים.\n\n` +

                `לחץ על **התחל העברה**.`,

            components: [
                row
            ]

        });
    }
);

// =====================================================
// BUTTON HANDLER
// =====================================================

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

        const parts =
            interaction.customId.split("_");

        const action =
            parts[1];

        const userId =
            parts[2];

        // =================================================
        // USER CHECK
        // =================================================

        if (
            interaction.user.id !==
            userId
        ) {

            return interaction.reply({

                content:
                    "❌ רק מי שהפעיל את ההעברה יכול להשתמש בכפתורים.",

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

        // =================================================
        // CANCEL
        // =================================================

        if (
            action === "cancel"
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

        // =================================================
        // START
        // =================================================

        if (
            action === "start"
        ) {

            await interaction.update({

                content:

                    "⏳ **מתחיל להעתיק את השרת...**\n\n" +

                    "🏷️ שם\n" +

                    "🖼️ אייקון\n" +

                    "🎭 תפקידים\n" +

                    "📁 קטגוריות\n" +

                    "💬 ערוצים\n" +

                    "🔐 הרשאות\n\n" +

                    "זה יכול לקחת קצת זמן...",

                components: []

            });

            try {

                const targetGuild =
                    await client.guilds.fetch(
                        data.targetId
                    );

                await targetGuild.roles.fetch();

                await targetGuild.channels.fetch();

                // =========================================
                // TRANSFER
                // =========================================

                const stats =
                    await transferServer(

                        data.sourceGuild,

                        targetGuild,

                        data.sourceRoles,

                        data.sourceChannels

                    );

                pendingTransfers.delete(
                    userId
                );

                // =========================================
                // LEAVE BUTTON
                // =========================================

                const leaveButton =
                    new ButtonBuilder()

                        .setCustomId(
                            `transfer_leave_${userId}`
                        )

                        .setLabel(
                            "🚪 עזוב את השרת הישן"
                        )

                        .setStyle(
                            ButtonStyle.Danger
                        );

                const keepButton =
                    new ButtonBuilder()

                        .setCustomId(
                            `transfer_keep_${userId}`
                        )

                        .setLabel(
                            "השאר את הבוט בישן"
                        )

                        .setStyle(
                            ButtonStyle.Secondary
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            leaveButton,
                            keepButton
                        );

                // =========================================
                // RESULT
                // =========================================

                await interaction.followUp({

                    content:

                        `# ✅ ההעברה הסתיימה!\n\n` +

                        `📥 **מקור:** ${data.sourceGuild.name}\n` +

                        `📤 **יעד:** ${targetGuild.name}\n\n` +

                        `🏷️ שם השרת: **${stats.name ? "✅" : "❌"}**\n` +

                        `🖼️ אייקון: **${stats.icon ? "✅" : "❌"}**\n\n` +

                        `🎭 תפקידים: **${stats.roles}** נוצרו\n` +

                        `📁 קטגוריות: **${stats.categories}** נוצרו\n` +

                        `💬 ערוצים: **${stats.channels}** נוצרו\n\n` +

                        `⚠️ הודעות ישנות וחברי השרת לא הועתקו.\n\n` +

                        `**מה לעשות עם הבוט בשרת הישן?**`,

                    components: [
                        row
                    ],

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

                        `שגיאה:\n` +

                        `\`${error.message}\`\n\n` +

                        `ודא שלבוט יש Administrator בשני השרתים.`,

                    ephemeral: true

                });
            }
        }
    }
);

// =====================================================
// LEAVE / KEEP OLD SERVER
// =====================================================

client.on(
    Events.InteractionCreate,
    async interaction => {

        if (
            !interaction.isButton()
        ) {
            return;
        }

        // =================================================
        // LEAVE
        // =================================================

        if (
            interaction.customId.startsWith(
                "transfer_leave_"
            )
        ) {

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
                        "❌ רק מי שהפעיל את ההעברה יכול לעשות את זה.",

                    ephemeral: true

                });
            }

            // =============================================
            // CONFIRMATION
            // =============================================

            const confirm =
                new ButtonBuilder()

                    .setCustomId(
                        `transfer_confirmleave_${userId}`
                    )

                    .setLabel(
                        "כן, עזוב את השרת הישן"
                    )

                    .setStyle(
                        ButtonStyle.Danger
                    );

            const cancel =
                new ButtonBuilder()

                    .setCustomId(
                        `transfer_cancelleave_${userId}`
                    )

                    .setLabel(
                        "ביטול"
                    )

                    .setStyle(
                        ButtonStyle.Secondary
                    );

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        confirm,
                        cancel
                    );

            return interaction.update({

                content:

                    `⚠️ **אתה בטוח?**\n\n` +

                    `הבוט יעזוב את שרת המקור.\n\n` +

                    `⚠️ זה **לא מוחק את השרת**.\n` +

                    `אם אתה הבעלים, תוכל למחוק את השרת ידנית דרך Discord.`,

                components: [
                    row
                ]

            });
        }

        // =================================================
        // CANCEL LEAVE
        // =================================================

        if (
            interaction.customId.startsWith(
                "transfer_cancelleave_"
            )
        ) {

            return interaction.update({

                content:

                    "✅ הבוט נשאר בשרת הישן.",

                components: []

            });
        }

        // =================================================
        // CONFIRM LEAVE
        // =================================================

        if (
            interaction.customId.startsWith(
                "transfer_confirmleave_"
            )
        ) {

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
                        "❌ אין לך הרשאה לעשות את זה.",

                    ephemeral: true

                });
            }

            // =============================================
            // FIND SOURCE FROM SAVED DATA
            // =============================================

            // The transfer is already finished,
            // so we need to use the guild ID
            // saved temporarily below.

            const sourceId =
                lastCompletedTransfers.get(
                    userId
                );

            if (!sourceId) {

                return interaction.update({

                    content:

                        "❌ לא מצאתי את שרת המקור. ההעברה כנראה הסתיימה לפני זמן רב.",

                    components: []

                });
            }

            try {

                const sourceGuild =
                    client.guilds.cache.get(
                        sourceId
                    );

                if (!sourceGuild) {

                    return interaction.update({

                        content:

                            "ℹ️ הבוט כבר לא נמצא בשרת הישן.",

                        components: []

                    });
                }

                await sourceGuild.leave();

                lastCompletedTransfers.delete(
                    userId
                );

                await interaction.update({

                    content:

                        `🚪 **הבוט עזב את שרת המקור בהצלחה.**\n\n` +

                        `✅ השרת החדש נשאר פעיל.\n` +

                        `⚠️ השרת הישן עצמו לא נמחק.`,

                    components: []

                });

            } catch (error) {

                console.error(
                    "❌ Leave error:",
                    error
                );

                await interaction.update({

                    content:

                        `❌ לא הצלחתי לעזוב את השרת.\n\n` +

                        `\`${error.message}\``,

                    components: []

                });
            }
        }

        // =================================================
        // KEEP
        // =================================================

        if (
            interaction.customId.startsWith(
                "transfer_keep_"
            )
        ) {

            return interaction.update({

                content:

                    "✅ **הבוט נשאר בשרת הישן.**",

                components: []

            });
        }
    }
);

// =====================================================
// LAST COMPLETED TRANSFERS
// =====================================================

const lastCompletedTransfers =
    new Map();

// =====================================================
// SAVE SOURCE AFTER TRANSFER
// =====================================================

// We listen to the interaction again to detect
// successful transfer messages and save the source.
// This does not interfere with the main handler.

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
                "transfer_start_"
            )
        ) {
            return;
        }

        const userId =
            interaction.customId
                .split("_")
                .pop();

        const data =
            pendingTransfers.get(
                userId
            );

        if (data) {

            lastCompletedTransfers.set(
                userId,
                data.sourceId
            );
        }
    }
);

// =====================================================
// LOGIN
// =====================================================

client.login(TOKEN);
