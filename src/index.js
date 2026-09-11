import { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } from "discord.js";
import { PlayerManager } from "ziplayer";
import { YouTubePlugin, SpotifyPlugin } from "@ziplayer/plugin";
import express from "express";

// 1. Keep-Alive Server
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot đang chạy!"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// 2. Discord Client & PlayerManager
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
    autoCleanup: true,[span_0](start_span)[span_0](end_span)
    enableSearchCache: true,[span_1](start_span)[span_1](end_span)
});

// 3. Xử lý Lệnh
client.on("messageCreate", async (msg) => {
    if (!msg.guildId || msg.author.bot || !msg.content.startsWith("!")) return;

    const args = msg.content.slice(1).split(" ");
    const command = args[0].toLowerCase();
    const query = args.slice(1).join(" ");

    const player = await manager.create(msg.guildId, {
        lowPerformance: true,[span_2](start_span)[span_2](end_span)
        antiStuck: { enabled: true, maxRetries: 2, retryDelayMs: 1000 }
    });

    const voiceChannel = msg.member?.voice.channel;

    // Hàm kiểm tra quyền: Trả về true nếu là người yêu cầu bài hát HOẶC là Admin/Mod
    const hasPermission = () => {
        const currentTrack = player.currentTrack;
        const isAdmin = msg.member.permissions.has(PermissionsBitField.Flags.ManageChannels) || 
                        msg.member.permissions.has(PermissionsBitField.Flags.Administrator);
        
        // Nếu không có bài nào đang phát, cho phép thực thi
        if (!currentTrack) return true; 

        // Kiểm tra xem ID người dùng có khớp với requestedBy của bài hát hay không
        const isRequester = currentTrack.requestedBy === msg.author.id;

        return isRequester || isAdmin;
    };

    switch (command) {
        case "play":
        case "p":
            if (!query) return msg.reply("⚠️ Vui lòng nhập tên bài hát hoặc URL!");
            if (!voiceChannel) return msg.reply("⚠️ Bạn phải vào Voice Channel trước!");

            if (!player.connection) await player.connect(voiceChannel);

            try {
                // Lưu ID của tác giả lệnh vào requestedBy
                await player.play(query, msg.author.id);[span_3](start_span)[span_3](end_span)
                msg.reply(`🔎 Đã thêm: **${query}**`);
            } catch (err) {
                msg.reply("❌ Không thể phát bài hát này!");
            }
            break;

        case "pause":
            if (!hasPermission()) {
                return msg.reply("❌ Chỉ người thêm bài hát này hoặc Admin mới có quyền tạm dừng!");
            }
            player.pause();[span_4](start_span)[span_4](end_span)
            msg.reply("⏸️ Đã tạm dừng.");
            break;

        case "resume":
            if (!hasPermission()) {
                return msg.reply("❌ Chỉ người thêm bài hát này hoặc Admin mới có quyền phát tiếp!");
            }
            player.resume();[span_5](start_span)[span_5](end_span)
            msg.reply("▶️ Tiếp tục phát.");
            break;

        case "skip":
        case "s":
            if (!hasPermission()) {
                return msg.reply("❌ Chỉ người thêm bài hát này hoặc Admin mới có quyền bỏ qua!");
            }
            player.skip();[span_6](start_span)[span_6](end_span)
            msg.reply("⏭️ Đã chuyển bài.");
            break;

        case "stop":
            if (!hasPermission()) {
                return msg.reply("❌ Chỉ người thêm bài hát này hoặc Admin mới có quyền dừng nhạc!");
            }
            player.stop();[span_7](start_span)[span_7](end_span)
            msg.reply("⏹️ Đã dừng nhạc.");
            break;

        case "queue":
        case "q":
            const tracks = player.upcomingTracks.slice(0, 10);[span_8](start_span)[span_8](end_span)
            const embed = new EmbedBuilder()
                .setTitle("🎶 Hàng Đợi")
                .setDescription(tracks.map((t, i) => `${i + 1}. **${t.title}**`).join("\n") || "Hàng đợi trống.");
            msg.reply({ embeds: [embed] });
            break;
    }
});

client.login(process.env.DISCORD_TOKEN);
