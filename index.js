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
const fs = require("fs");
const path = require("path");

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
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
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
        bot: client.user ? client.user.tag : null
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
// DATA
// =====================================================

const DATA_FILE = path.join(__dirname, "data.json");

let data = {
    buildTests: {},
    transfers: {}
};

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            data = JSON.parse(
                fs.readFileSync(DATA_FILE, "utf8")
            );
        }
    } catch (error) {
        console.log(
            "⚠️ Could not load data.json:",
            error.message
        );
    }
}

function saveData() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(data, null, 2)
        );
    } catch (error) {
        console.log(
            "❌ Could not save data.json:",
            error.message
        );
    }
}

loadData();

// =====================================================
// PENDING TRANSFERS
// =====================================================

const pendingTransfers = new Map();

// =====================================================
// PENDING BUILD TESTS
// =====================================================

const pendingBuildTests = new Map();

// =====================================================
// SLASH COMMAND
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
// REGISTER COMMANDS
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

async function getSourceGuild(serverId) {

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

async function getSourceRoles(serverId) {

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

async function getSourceChannels(serverId) {

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
// PERMISSION OVERWRITES
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

        if (overwrite.type !== 0) {
            continue;
        }

        let targetRoleId;

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
            "🏷️ Server name copied"
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

            }

            roleMap.set(
                sourceRole.id,
                targetRole.id
            );

        } catch (error) {

            stats.rolesFailed++;

            console.log(
                `❌ Role failed: ${sourceRole.name}`,
                error.message
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

            if (overwrites.length > 0) {

                await targetCategory
                    .permissionOverwrites
                    .set(
                        overwrites,
                        "Discord Server Transfer"
                    );
            }

            stats.categories++;

        } catch (error) {

            stats.categoriesFailed++;

            console.log(
                `❌ Category failed: ${sourceCategory.name}`,
                error.message
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
                0,
                2,
                5,
                13,
                15
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

            // Parent
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

            // Text
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

            // Announcement
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

            // Voice
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

            const targetChannel =
                await targetGuild.channels.create(
                    options
                );

            const overwrites =
                convertOverwrites(
                    sourceChannel.permission_overwrites,
                    roleMap,
                    sourceGuild.id,
                    targetGuild.id
                );

            if (overwrites.length > 0) {

                await targetChannel
                    .permissionOverwrites
                    .set(
                        overwrites,
                        "Discord Server Transfer"
                    );
            }

            stats.channels++;

        } catch (error) {

            stats.channelsFailed++;

            console.log(
                `❌ Channel failed: ${sourceChannel.name}`,
                error.message
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
                    "❌ לא נמצאו תפקידים או ערוצים בשרת המקור."

            });
        }

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

        await interaction.editReply({

            content:

                `# 📦 העתקת שרת\n\n` +

                `📥 **מקור:** ${sourceGuild.name}\n` +

                `📤 **יעד:** ${targetGuild.name}\n\n` +

                `🏷️ שם: **כן**\n` +

                `🖼️ אייקון: **${sourceGuild.icon ? "כן" : "אין"}**\n` +

                `🎭 תפקידים: **${roleCount}**\n` +

                `📁 קטגוריות: **${categoryCount}**\n` +

                `💬 ערוצים: **${channelCount}**\n\n` +

                `לחץ על **התחל העברה**.`,

            components: [
                row
            ]

        });
    }
);

// =====================================================
// TRANSFER BUTTONS
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

        if (
            interaction.user.id !==
            userId
        ) {

            return interaction.reply({

                content:
                    "❌ רק מי שהפעיל את ההעברה יכול להשתמש בכפתור.",

                ephemeral: true

            });
        }

        const transfer =
            pendingTransfers.get(
                userId
            );

        if (!transfer) {

            return interaction.reply({

                content:
                    "❌ ההעברה פגה. הפעל /transfer מחדש.",

                ephemeral: true

            });
        }

        if (
            action === "cancel"
        ) {

            pendingTransfers.delete(
                userId
            );

            return interaction.update({

                content:
                    "❌ ההעברה בוטלה.",

                components: []

            });
        }

        if (
            action !== "start"
        ) {
            return;
        }

        await interaction.update({

            content:
                "⏳ **מעביר את השרת...**\n\n" +
                "🏷️ שם\n" +
                "🖼️ אייקון\n" +
                "🎭 תפקידים\n" +
                "📁 קטגוריות\n" +
                "💬 ערוצים\n" +
                "🔐 הרשאות",

            components: []

        });

        try {

            const targetGuild =
                await client.guilds.fetch(
                    transfer.targetId
                );

            await targetGuild.roles.fetch();
            await targetGuild.channels.fetch();

            const stats =
                await transferServer(
                    transfer.sourceGuild,
                    targetGuild,
                    transfer.sourceRoles,
                    transfer.sourceChannels
                );

            pendingTransfers.delete(
                userId
            );

            await interaction.followUp({

                content:

                    `# ✅ ההעברה הסתיימה!\n\n` +

                    `🏷️ שם: **${stats.name ? "✅" : "❌"}**\n` +

                    `🖼️ אייקון: **${stats.icon ? "✅" : "❌"}**\n\n` +

                    `🎭 תפקידים: **${stats.roles}**\n` +

                    `📁 קטגוריות: **${stats.categories}**\n` +

                    `💬 ערוצים: **${stats.channels}**\n\n` +

                    `❌ כשלונות: **${stats.rolesFailed + stats.categoriesFailed + stats.channelsFailed}**\n\n` +

                    `⚠️ הבוט לא עזב ולא מחק את שרת המקור.`,

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
                    `❌ ההעברה נכשלה.\n\n` +
                    `\`${error.message}\``,

                ephemeral: true

            });
        }
    }
);

// =====================================================
// BUILD TEST - !בדיקה
// =====================================================

client.on(
    Events.MessageCreate,
    async message => {

        if (message.author.bot) {
            return;
        }

        if (
            message.content.trim() !==
            "!בדיקה"
        ) {
            return;
        }

        if (!message.guild) {
            return;
        }

        if (
            !message.member.permissions.has(
                PermissionFlagsBits.Administrator
            )
        ) {

            return message.reply(
                "❌ אתה חייב Administrator כדי להפעיל מצב בנייה."
            );
        }

        const guild =
            message.guild;

        const existing =
            data.buildTests[guild.id];

        if (
            existing &&
            existing.categoryId
        ) {

            const category =
                guild.channels.cache.get(
                    existing.categoryId
                );

            if (category) {

                return message.reply(
                    "⚠️ כבר קיימת סביבת TEST בשרת.\nהשתמש ב־`!נקהבדיקה` לפני יצירה מחדש."
                );
            }
        }

        const confirmButton =
            new ButtonBuilder()
                .setCustomId(
                    `build_confirm_${message.author.id}_${guild.id}`
                )
                .setLabel(
                    "🧪 צור סביבת בנייה"
                )
                .setStyle(
                    ButtonStyle.Success
                );

        const cancelButton =
            new ButtonBuilder()
                .setCustomId(
                    `build_cancel_${message.author.id}_${guild.id}`
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
                    confirmButton,
                    cancelButton
                );

        pendingBuildTests.set(
            message.author.id,
            {
                guildId:
                    guild.id,
                createdAt:
                    Date.now()
            }
        );

        await message.reply({

            content:

                `# 🧪 מצב בנייה\n\n` +

                `הפקודה תיצור:\n\n` +

                `📁 **10 קטגוריות**\n` +

                `💬 **100 חדרים**\n` +

                `🧪 שמות TEST מסודרים\n\n` +

                `⚠️ המערכת **לא מוחקת ערוצים קיימים** ולא מתייגת חברים.\n\n` +

                `לחץ על הכפתור כדי להתחיל.`,

            components: [
                row
            ]

        });
    }
);

// =====================================================
// BUILD BUTTONS
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
                "build_"
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

        const guildId =
            parts[3];

        if (
            interaction.user.id !==
            userId
        ) {

            return interaction.reply({

                content:
                    "❌ רק מי שהפעיל את הבדיקה יכול להשתמש בכפתור.",

                ephemeral: true

            });
        }

        const guild =
            client.guilds.cache.get(
                guildId
            );

        if (!guild) {

            return interaction.reply({

                content:
                    "❌ השרת לא נמצא.",

                ephemeral: true

            });
        }

        // =================================================
        // CANCEL
        // =================================================

        if (
            action === "cancel"
        ) {

            pendingBuildTests.delete(
                userId
            );

            return interaction.update({

                content:
                    "❌ מצב הבנייה בוטל.",

                components: []

            });
        }

        // =================================================
        // CONFIRM
        // =================================================

        if (
            action !== "confirm"
        ) {
            return;
        }

        pendingBuildTests.delete(
            userId
        );

        await interaction.update({

            content:
                "⏳ **יוצר סביבת בנייה...**\n\n" +
                "📁 יוצר קטגוריות\n" +
                "💬 יוצר 100 חדרים\n\n" +
                "זה יכול לקחת קצת זמן...",

            components: []

        });

        try {

            // =============================================
            // MAIN CATEGORY
            // =============================================

            const mainCategory =
                await guild.channels.create({

                    name:
                        "🧪・nuke TEST",

                    type:
                        ChannelType.GuildCategory,

                    reason:
                        "Build Test System"

                });

            const createdCategories = [
                mainCategory.id
            ];

            const createdChannels = [];

            // =============================================
            // 10 CATEGORIES
            // =============================================

            for (
                let categoryNumber = 1;
                categoryNumber <= 10;
                categoryNumber++
            ) {

                const category =
                    await guild.channels.create({

                        name:
                            `🧪・nuke ${String(categoryNumber).padStart(2, "0")}`,

                        type:
                            ChannelType.GuildCategory,

                        parent:
                            mainCategory.id,

                        reason:
                            "Build Test System"

                    });

                createdCategories.push(
                    category.id
                );

                // =========================================
                // 10 CHANNELS PER CATEGORY
                // =========================================

                for (
                    let channelNumber = 1;
                    channelNumber <= 10;
                    channelNumber++
                ) {

                    const channel =
                        await guild.channels.create({

                            name:
                                `test-${String(categoryNumber).padStart(2, "0")}-${String(channelNumber).padStart(2, "0")}`,

                            type:
                                ChannelType.GuildText,

                            parent:
                                category.id,

                            topic:
                                "🧪 nuke Test Channel",

                            reason:
                                "Build Test System"

                        });

                    createdChannels.push(
                        channel.id
                    );

                    // =====================================
                    // TEST MESSAGE
                    // =====================================

                    await channel.send({

                        content:

                            `🧪 **nuke TEST**\n\n` +

                            `קטגוריה: **${categoryNumber}/10**\n` +

                            `חדר: **${channelNumber}/10**\n\n` +

                            `החדר נוצר בהצלחה על ידי מערכת הבנייה.`

                    });

                    // =====================================
                    // SMALL DELAY
                    // =====================================

                    await new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                150
                            )
                    );
                }
            }

            // =============================================
            // SAVE
            // =============================================

            data.buildTests[guild.id] = {

                mainCategoryId:
                    mainCategory.id,

                categoryIds:
                    createdCategories,

                channelIds:
                    createdChannels,

                createdBy:
                    interaction.user.id,

                createdAt:
                    Date.now()

            };

            saveData();

            // =============================================
            // RESULT
            // =============================================

            await interaction.followUp({

                content:

                    `# ✅ סביבת הבנייה מוכנה!\n\n` +

                    `📁 קטגוריות: **10**\n` +

                    `💬 חדרים: **100**\n\n` +

                    `🧪 כל החדרים נמצאים תחת:\n` +

                    `**🧪・nuke TEST**\n\n` +

                    `כשתרצה לנקות אותם השתמש ב־\`!נקהבדיקה\`.`,

                ephemeral: true

            });

        } catch (error) {

            console.error(
                "❌ BUILD TEST ERROR:",
                error
            );

            await interaction.followUp({

                content:

                    `❌ **הבנייה נעצרה.**\n\n` +

                    `שגיאה:\n` +

                    `\`${error.message}\`\n\n` +

                    `ייתכן שהגעת ל־Rate Limit של Discord.`,

                ephemeral: true

            });
        }
    }
);

// =====================================================
// !נקהבדיקה
// =====================================================

client.on(
    Events.MessageCreate,
    async message => {

        if (message.author.bot) {
            return;
        }

        if (
            message.content.trim() !==
            "!נקהבדיקה"
        ) {
            return;
        }

        if (!message.guild) {
            return;
        }

        if (
            !message.member.permissions.has(
                PermissionFlagsBits.Administrator
            )
        ) {

            return message.reply(
                "❌ אתה חייב Administrator."
            );
        }

        const guild =
            message.guild;

        const test =
            data.buildTests[guild.id];

        if (!test) {

            return message.reply(
                "ℹ️ לא מצאתי סביבת BUILD TEST שנוצרה על ידי הבוט."
            );
        }

        const confirmButton =
            new ButtonBuilder()
                .setCustomId(
                    `cleanup_confirm_${message.author.id}_${guild.id}`
                )
                .setLabel(
                    "🗑️ נקה TEST"
                )
                .setStyle(
                    ButtonStyle.Danger
                );

        const cancelButton =
            new ButtonBuilder()
                .setCustomId(
                    `cleanup_cancel_${message.author.id}_${guild.id}`
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
                    confirmButton,
                    cancelButton
                );

        await message.reply({

            content:

                `# 🧹 ניוק BUILD TEST\n\n` +

                `יימחקו רק:\n` +

                `📁 **קטגוריות הבדיקה**\n` +

                `💬 **100 חדרי הבדיקה**\n\n` +

                `❗ שום ערוץ רגיל בשרת לא יימחק.`,

            components: [
                row
            ]

        });
    }
);

// =====================================================
// CLEANUP BUTTONS
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
                "cleanup_"
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

        const guildId =
            parts[3];

        if (
            interaction.user.id !==
            userId
        ) {

            return interaction.reply({

                content:
                    "❌ רק מי שהפעיל את הניקוי יכול להשתמש בכפתור.",

                ephemeral: true

            });
        }

        if (
            action === "cancel"
        ) {

            return interaction.update({

                content:
                    "✅ הניקוי בוטל.",

                components: []

            });
        }

        if (
            action !== "confirm"
        ) {
            return;
        }

        const guild =
            client.guilds.cache.get(
                guildId
            );

        if (!guild) {

            return interaction.update({

                content:
                    "❌ השרת לא נמצא.",

                components: []

            });
        }

        const test =
            data.buildTests[guild.id];

        if (!test) {

            return interaction.update({

                content:
                    "ℹ️ סביבת הבדיקה כבר לא קיימת.",

                components: []

            });
        }

        await interaction.update({

            content:
                "⏳ **מנקה את סביבת הבדיקה...**",

            components: []

        });

        let deletedChannels = 0;
        let deletedCategories = 0;

        // =================================================
        // DELETE CHANNELS
        // =================================================

        for (
            const channelId
            of test.channelIds || []
        ) {

            try {

                const channel =
                    guild.channels.cache.get(
                        channelId
                    );

                if (channel) {

                    await channel.delete(
                        "Build Test Cleanup"
                    );

                    deletedChannels++;
                }

            } catch (error) {

                console.log(
                    `❌ Could not delete channel ${channelId}:`,
                    error.message
                );
            }
        }

        // =================================================
        // DELETE CATEGORIES
        // =================================================

        for (
            const categoryId
            of test.categoryIds || []
        ) {

            try {

                const category =
                    guild.channels.cache.get(
                        categoryId
                    );

                if (category) {

                    await category.delete(
                        "Build Test Cleanup"
                    );

                    deletedCategories++;
                }

            } catch (error) {

                console.log(
                    `❌ Could not delete category ${categoryId}:`,
                    error.message
                );
            }
        }

        // =================================================
        // DELETE MAIN CATEGORY
        // =================================================

        try {

            const mainCategory =
                guild.channels.cache.get(
                    test.mainCategoryId
                );

            if (mainCategory) {

                await mainCategory.delete(
                    "Build Test Cleanup"
                );

                deletedCategories++;
            }

        } catch (error) {

            console.log(
                "❌ Could not delete main category:",
                error.message
            );
        }

        // =================================================
        // REMOVE DATA
        // =================================================

        delete data.buildTests[guild.id];

        saveData();

        // =================================================
        // RESULT
        // =================================================

        await interaction.followUp({

            content:

                `# 🧹 הניקוי הסתיים!\n\n` +

                `💬 חדרים שנמחקו: **${deletedChannels}**\n` +

                `📁 קטגוריות שנמחקו: **${deletedCategories}**\n\n` +

                `✅ ערוצים רגילים בשרת לא נגעו.`,

            ephemeral: true

        });
    }
);

// =====================================================
// LOGIN
// =====================================================

client.login(TOKEN);
import ://dv8tion.com.jda.api.Permission;
import ://dv8tion.com.jda.api.entities.channel.concrete.TextChannel;
import ://dv8tion.com.jda.api.events.message.MessageReceivedEvent;
import ://dv8tion.com.jda.api.hooks.ListenerAdapter;

public class DiscordBotListener extends ListenerAdapter {

    @Override
    public void onMessageReceived(MessageReceivedEvent event) {
        String message = event.getMessage().getContentRaw();

        // בדיקה אם נכתבה פקודת הניקוי
        if (message.equalsIgnoreCase("!clean")) {
            
            // הגנה: בדיקה אם המשתמש הוא אדמין
            if (!event.getMember().hasPermission(Permission.ADMINISTRATOR)) {
                event.getChannel().sendMessage("❌ אין לך הרשאה להשתמש בפקודה זו!").queue();
                return;
            }

            event.getChannel().sendMessage("🧹 מתחיל למחוק את כל החדרים...").queue();

            // לולאה שרצה על כל החדרים והקטגוריות בשרת ומוחקת אותם
            event.getGuild().getChannels().forEach(channel -> {
                channel.delete().queue(
                    success -> {}, 
                    error -> System.out.println("לא הצלחתי למחוק חדר: " + error.getMessage())
                );
            });

            // יצירת חדר חדש ונקי כדי שהשרת לא יישאר ריק
            event.getGuild().createTextChannel("לובי-חדש").queue(newChannel -> {
                newChannel.sendMessage("✨ השרת נוקה בהצלחה! עכשיו אפשר להתחיל לעצב.").queue();
            });
        }
    }
}
