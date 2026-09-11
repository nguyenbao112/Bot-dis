import { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } from "discord.js";
import { PlayerManager } from "ziplayer";
import { YouTubePlugin, SpotifyPlugin } from "@ziplayer/plugin";
import express from "express";

// 1. Web Server Keep-Alive cho Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("Bot đang chạy 24/7!");
});

app.listen(PORT, () => {
    console.log(`Web server đang chạy ở cổng ${PORT}`);
});

// 2. Cấu hình Discord Bot & ZiPlayer
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const manager = new PlayerManager({
    plugins: [new YouTubePlugin(), new SpotifyPlugin()],
    autoCleanup: true,
    enableSearchCache: true,
    extractorTimeout: 30000,
});

// Cập nhật dùng clientReady thay cho ready để khắc phục cảnh báo DeprecationWarning
client.on("clientReady", () => {
    console.log(`Bot đã sẵn sàng hoạt động: ${client.user.tag}`);
});

// 3. Xử lý Lệnh
client.on("messageCreate", async (msg) => {
    // Dòng log giúp kiểm tra xem bot có thực sự đọc được tin nhắn từ kênh hay không
    if (msg.content.startsWith("!")) {
        console.log(`[Message Received] Tác giả: ${msg.author.tag} | Nội dung: ${msg.content}`);
    }

    if (!msg.guildId || msg.author.bot || !msg.content.startsWith("!")) return;

    const args = msg.content.slice(1).split(" ");
    const command = args[0].toLowerCase();
    const query = args.slice(1).join(" ");

    const player = await manager.create(msg.guildId, {
        lowPerformance: true,
        antiStuck: {
            enabled: true,
            maxRetries: 2,
            retryDelayMs: 1000,
        }
    });

    const voiceChannel = msg.member?.voice.channel;

    // Kiểm tra quyền (chỉ người gọi bài hát hoặc Admin/Mod mới có quyền thao tác)
    const hasPermission = () => {
        const currentTrack = player.currentTrack;
        const isAdmin = msg.member?.permissions.has(PermissionsBitField.Flags.ManageChannels) || 
                        msg.member?.permissions.has(PermissionsBitField.Flags.Administrator);
        
        if (!currentTrack) return true;
        return currentTrack.requestedBy === msg.author.id || isAdmin;
    };

    switch (command) {
        case "play":
        case "p":
            if (!query) return msg.reply("⚠️ Vui lòng nhập tên bài hát hoặc URL!");
            if (!voiceChannel) return msg.reply("⚠️ Bạn phải vào Voice Channel trước!");

            if (!player.connection) await player.connect(voiceChannel);

            try {
                await player.play(query, msg.author.id);
                msg.reply(`🔎 Đã thêm vào hàng đợi: **${query}**`);
            } catch (err) {
                console.error(err);
                msg.reply("❌ Không thể phát bài hát này!");
            }
            break;

        case "pause":
            if (!hasPermission()) return msg.reply("❌ Chỉ người thêm bài hát hoặc Admin mới có quyền tạm dừng!");
            player.pause();
            msg.reply("⏸️ Đã tạm dừng.");
            break;

        case "resume":
        case "r":
            if (!hasPermission()) return msg.reply("❌ Chỉ người thêm bài hát hoặc Admin mới có quyền phát tiếp!");
            player.resume();
            msg.reply("▶️ Tiếp tục phát.");
            break;

        case "skip":
        case "s":
            if (!hasPermission()) return msg.reply("❌ Chỉ người thêm bài hát hoặc Admin mới có quyền bỏ qua!");
            player.skip();
            msg.reply("⏭️ Đã chuyển bài.");
            break;

        case "stop":
            if (!hasPermission()) return msg.reply("❌ Chỉ người thêm bài hát hoặc Admin mới có quyền dừng nhạc!");
            player.stop();
            msg.reply("⏹️ Đã dừng nhạc và xóa hàng đợi.");
            break;

        case "volume":
        case "vol":
            const vol = parseInt(query);
            if (isNaN(vol) || vol < 0 || vol > 200) {
                return msg.reply("⚠️ Âm lượng phải là một số từ 0 đến 200!");
            }
            player.setVolume(vol);
            msg.reply(`🔊 Đã chỉnh âm lượng thành: **${vol}%**`);
            break;

        case "queue":
        case "q":
            const tracks = player.upcomingTracks.slice(0, 10);
            const embed = new EmbedBuilder()
                .setTitle("🎶 Hàng Đợi")
                .setColor("#0099ff")
                .setDescription(tracks.map((t, i) => `${i + 1}. **${t.title}**`).join("\n") || "Hàng đợi trống.");
            msg.reply({ embeds: [embed] });
            break;

        case "np":
        case "nowplaying":
            const track = player.currentTrack;
            if (!track) return msg.reply("❌ Hiện tại không có bài hát nào đang phát!");

            const progress = player.getProgressBar({ size: 15 });
            const time = player.getTime();

            const npEmbed = new EmbedBuilder()
                .setTitle("🎧 Đang Phát")
                .setDescription(`**[${track.title}](${track.url})**\n\n\`${progress}\`\n${time.formatted.current} / ${time.formatted.total}`)
                .setThumbnail(track.thumbnail || null)
                .setColor("#00ff00");

            msg.reply({ embeds: [npEmbed] });
            break;

        case "help":
            const helpEmbed = new EmbedBuilder()
                .setTitle("📖 DANH SÁCH LỆNH BOT")
                .setColor("#00ff00")
                .addFields(
                    { name: "▶️ Phát & Điều Khiển", value: "`!play <tên/link>` hoặc `!p` - Phát nhạc\n`!pause` - Tạm dừng\n`!resume` hoặc `!r` - Tiếp tục\n`!skip` hoặc `!s` - Chuyển bài\n`!stop` - Dừng nhạc" },
                    { name: "⚙️ Tùy Chỉnh & Hàng Đợi", value: "`!queue` hoặc `!q` - Xem danh sách chờ\n`!nowplaying` hoặc `!np` - Bài đang phát\n`!volume <0-200>` - Chỉnh âm lượng" }
                );
            msg.reply({ embeds: [helpEmbed] });
            break;
    }
});

client.login(process.env.DISCORD_TOKEN);
