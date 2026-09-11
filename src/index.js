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

client.on("ready", () => {
    console.log(`Bot kết nối thành công: ${client.user.tag}`);
});

// 3. Xử lý Lệnh
client.on("messageCreate", async (msg) => {
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

    // Kiểm tra quyền (chỉ người gọi bài hát hoặc Admin/Mod)
    const hasPermission = () => {
        const currentTrack = player.currentTrack;
        const isAdmin = msg.member.permissions.has(PermissionsBitField.Flags.ManageChannels) || 
                        msg.member.permissions.has(PermissionsBitField.Flags.Administrator);
        
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

        case "queue":
        case "q":
            const tracks = player.upcomingTracks.slice(0, 10);
            const embed = new EmbedBuilder()
                .setTitle("🎶 Hàng Đợi")
                .setDescription(tracks.map((t, i) => `${i + 1}. **${t.title}**`).join("\n") || "Hàng đợi trống.");
            msg.reply({ embeds: [embed] });
            break;
    }
});

client.login(process.env.DISCORD_TOKEN);
