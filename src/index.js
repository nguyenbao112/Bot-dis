import "dotenv/config";
import http from "http";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  Events,
} from "discord.js";
import { PlayerManager } from "ziplayer";
import {
  YouTubePlugin,
  SpotifyPlugin,
  TTSPlugin,
} from "@ziplayer/plugin";
import { InfinityPlugin } from "@ziplayer/infinity";

/* =========================================================
   CONFIG
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!TOKEN) {
  console.error("❌ Không tìm thấy DISCORD_TOKEN hoặc TOKEN trong .env");
  process.exit(1);
}

/* =========================================================
   DISCORD CLIENT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* =========================================================
   PLAYER MANAGER
========================================================= */

const manager = new PlayerManager({
  plugins: [
    new YouTubePlugin(),
    new SpotifyPlugin(),
    new TTSPlugin(),
    new InfinityPlugin(),
  ],
  autoCleanup: false,
  leaveOnEmpty: false,
  leaveOnEnd: false,
  extractorTimeout: 60000,
});

/* =========================================================
   READY
========================================================= */

client.once(Events.ClientReady, (readyClient) => {
  console.log("========================================");
  console.log("🤖 BOT MUSIC ĐÃ ONLINE SẴN SÀNG");
  console.log(`👤 ${readyClient.user.tag}`);
  console.log("🎵 Nguồn hỗ trợ: YouTube, Spotify, Infinity");
  console.log("========================================");
});

/* =========================================================
   EQUALIZER / FILTER
========================================================= */

const applyClarity = async (player) => {
  if (!player) return false;

  try {
    if (player.filter && typeof player.filter.applyFilter === "function") {
      await player.filter.applyFilter("trebleboost");
    }
    return true;
  } catch (error) {
    console.warn("⚠️ Bỏ qua lỗi áp dụng EQ:", error?.message || error);
    return true;
  }
};

/* =========================================================
   EVENTS
========================================================= */

manager.on("trackStart", async (player, track) => {
  console.log(`[${player.guildId}] ▶️ Đang phát: ${track?.title || "Unknown"}`);
  await applyClarity(player);

  // Đổi Voice Channel Status sang tên bài hát
  try {
    const channelId = player.connection?.channelId || player.voiceChannelId;
    if (channelId) {
      const voiceChannel = await client.channels.fetch(channelId);
      if (voiceChannel && typeof voiceChannel.setStatus === "function") {
        await voiceChannel.setStatus(track?.title || "Đang phát nhạc...");
      }
    }
  } catch (err) {
    console.warn("⚠️ Không thể đổi Voice Status:", err?.message || err);
  }
});

manager.on("trackEnd", (player, track) => {
  console.log(`[${player.guildId}] ⏹️ Kết thúc: ${track?.title || "Unknown"}`);
});

manager.on("queueEnd", async (player) => {
  console.log(`[${player.guildId}] 📭 Hàng đợi đã hết.`);

  // Xóa Voice Channel Status khi hết nhạc
  try {
    const channelId = player.connection?.channelId || player.voiceChannelId;
    if (channelId) {
      const voiceChannel = await client.channels.fetch(channelId);
      if (voiceChannel && typeof voiceChannel.setStatus === "function") {
        await voiceChannel.setStatus("");
      }
    }
  } catch (err) {
    console.warn("⚠️ Không thể xóa Voice Status:", err?.message || err);
  }
});

manager.on("playerError", (player, error, track) => {
  console.error("========================================");
  console.error(`❌ PLAYER ERROR [${player?.guildId || "unknown"}]`);
  console.error("Track:", track?.title || "Không xác định");
  console.error(error);
  console.error("========================================");
});

/* =========================================================
   MESSAGE COMMAND
========================================================= */

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.guildId || msg.author.bot) return;

    // Kiểm tra tiền tố lệnh B. hoặc b.
    const prefix = "B.";
    if (!msg.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

    const parts = msg.content.slice(prefix.length).trim().split(/\s+/);
    const command = parts.shift()?.toLowerCase();
    const query = parts.join(" ").trim();

    const musicCommands = [
      "help", "h", "play", "p", "scplay", "sc", "pause", "resume", 
      "skip", "s", "stop", "volume", "vol", "filter", "clarity", 
      "queue", "q", "nowplaying", "np", "join", "leave"
    ];

    if (!musicCommands.includes(command)) return;

    /* HELP */
    if (command === "help" || command === "h") {
      const helpEmbed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("🎵 BẢNG HƯỚNG DẪN SỬ DỤNG BOT NHẠC")
        .setDescription("Tiền tố lệnh là: `B.`\nTrình phát hỗ trợ các nguồn: **YouTube, Spotify, Infinity**.")
        .addFields(
          {
            name: "▶️ Phát Nhạc",
            value: 
              "`B.play <tên bài/link>` (hoặc `B.p`): Phát nhạc từ YT, Spotify...\n" +
              "`B.scplay <tên bài/link>` (hoặc `B.sc`): Tìm và phát nhạc từ SoundCloud.",
          },
          {
            name: "🎛️ Điều Khiển Trình Phát",
            value: 
              "`B.pause`: Tạm dừng bài hát.\n" +
              "`B.resume`: Tiếp tục phát nhạc.\n" +
              "`B.skip` (hoặc `B.s`): Bỏ qua bài hiện tại (Chỉ dành cho người yêu cầu).\n" +
              "`B.stop`: Dừng phát và xóa hàng đợi.\n" +
              "`B.volume <0-200>` (hoặc `B.vol`): Chỉnh âm lượng bot.",
          },
          {
            name: "✨ Tối Ưu Âm Thanh & Hàng Đợi",
            value: 
              "`B.clarity` (hoặc `B.filter`): Bật bộ lọc làm rõ âm thanh Clarity EQ.\n" +
              "`B.queue` (hoặc `B.q`): Xem danh sách hàng đợi 10 bài tiếp theo.\n" +
              "`B.nowplaying` (hoặc `B.np`): Xem bài hát đang phát.",
          },
          {
            name: "📌 Kênh Voice",
            value: 
              "`B.join`: Cho bot vào phòng voice của bạn.\n" +
              "`B.leave`: Cho bot rời phòng voice.",
          }
        )
        .setFooter({ text: "Chúc bạn nghe nhạc vui vẻ!" });

      return msg.reply({ embeds: [helpEmbed] });
    }

    const voiceChannel = msg.member?.voice?.channel;

    let player = manager.get(msg.guildId);

    const getOrCreatePlayer = async () => {
      if (!player) {
        player = await manager.create(msg.guildId, {
          volume: 100,
          loudnessNormalization: { enabled: false },
          antiStuck: {
            enabled: true,
            maxRetries: 3,
            retryDelayMs: 1000,
            reusePreloadFirst: true,
            reduceQualityOnRetry: true,
          },
          leaveOnEmpty: false,
          leaveOnEnd: false,
          extractorTimeout: 60000,
          lowPerformance: false,
          preload: {
            enabled: true,
            autoDisableInLowPerformance: true,
          },
        });
      }
      return player;
    };

    /* JOIN */
    if (command === "join") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice trước.");
      try {
        const activePlayer = await getOrCreatePlayer();
        if (!activePlayer.connection) {
          await activePlayer.connect(voiceChannel, { selfDeaf: true });
        }
        return msg.reply(`📌 Đã vào **${voiceChannel.name}**`);
      } catch (error) {
        return msg.reply("❌ Không thể vào voice.");
      }
    }

    /* LEAVE */
    if (command === "leave") {
      if (!player) return msg.reply("❌ Bot chưa ở trong phòng voice.");

      // Reset trạng thái voice channel khi rời phòng
      try {
        if (voiceChannel && typeof voiceChannel.setStatus === "function") {
          await voiceChannel.setStatus("");
        }
      } catch (e) {}

      player.destroy();
      return msg.reply("👋 Bot đã rời phòng voice.");
    }

    /* PLAY / SCPLAY */
    if (command === "play" || command === "p" || command === "scplay" || command === "sc") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice trước.");
      if (!query) return msg.reply("❌ Dùng: `B.play <tên bài/URL>` hoặc `B.sc <tên bài hát SoundCloud>`");

      const activePlayer = await getOrCreatePlayer();

      try {
        if (!activePlayer.connection) {
          await activePlayer.connect(voiceChannel, { selfDeaf: true });
        }
      } catch (error) {
        return msg.reply("❌ Không kết nối được voice.");
      }

      const replyMsg = await msg.reply("🔎 Đang tìm và tải nhạc...");

      try {
        let searchQuery = query.trim();

        if (command === "scplay" || command === "sc") {
          if (!searchQuery.startsWith("http://") && !searchQuery.startsWith("https://")) {
            searchQuery = `scsearch:${searchQuery}`;
          }
        }

        const result = await activePlayer.play(searchQuery, msg.author.id);

        if (result?.type === "PLAYLIST" || Array.isArray(result?.tracks)) {
          const count = result?.tracks?.length || 0;
          return replyMsg.edit(`🎶 Đã thêm playlist **${count} bài** vào hàng đợi.`);
        }

        const trackName = result?.track?.title || result?.title || activePlayer.currentTrack?.title || query;
        return replyMsg.edit(`▶️ Đã phát/thêm bài hát:\n**${trackName}**`);
      } catch (error) {
        console.error("❌ PLAY ERROR:", error);
        return replyMsg.edit("❌ Không thể tải/phát bài hát này.");
      }
    }

    if (!player) return msg.reply("❌ Hiện tại bot chưa hoạt động trong Server này.");

    /* PAUSE */
    if (command === "pause") {
      if (!player.isPlaying) return msg.reply("❌ Nhạc không đang phát.");
      player.pause();
      return msg.reply("⏸️ Đã tạm dừng.");
    }

    /* RESUME */
    if (command === "resume") {
      if (!player.isPaused) return msg.reply("❌ Nhạc đang phát rồi.");
      player.resume();
      return msg.reply("▶️ Đã phát tiếp.");
    }

    /* SKIP (CHỈ CHO PHÉP NGƯỜI BẬT BÀI HÁT SKIP) */
    if (command === "skip" || command === "s") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice để sử dụng lệnh này.");
      
      const currentTrack = player.currentTrack;
      if (!currentTrack) return msg.reply("❌ Không có bài hát nào đang phát.");

      const isRequester = currentTrack.requestedBy === msg.author.id;

      if (!isRequester) {
        return msg.reply("🔒 Chỉ người đã yêu cầu bài hát này mới có quyền skip!");
      }

      player.skip();
      return msg.reply(`⏭️ **${msg.author.displayName}** đã bỏ qua bài hát!`);
    }

    /* STOP */
    if (command === "stop") {
      player.stop();

      // Reset trạng thái voice channel khi dừng nhạc
      try {
        if (voiceChannel && typeof voiceChannel.setStatus === "function") {
          await voiceChannel.setStatus("");
        }
      } catch (e) {}

      return msg.reply("⏹️ Đã dừng nhạc.");
    }

    /* VOLUME */
    if (command === "volume" || command === "vol") {
      const vol = Number.parseInt(query, 10);
      if (Number.isNaN(vol) || vol < 0 || vol > 200) return msg.reply("❌ Volume từ 0 đến 200.");
      player.setVolume(vol);
      return msg.reply(`🔊 Volume: **${vol}%**`);
    }

    /* CLARITY / FILTER */
    if (command === "clarity" || command === "filter") {
      if (!player.currentTrack && !player.isPlaying) {
        return msg.reply("❌ Không có bài hát nào đang phát để áp dụng bộ lọc.");
      }
      await applyClarity(player);
      return msg.reply("✨ Đã bật **Clarity EQ** – dải âm thanh đã được tối ưu!");
    }

    /* QUEUE */
    if (command === "queue" || command === "q") {
      const tracks = player.upcomingTracks?.slice(0, 10) || [];
      const queueList = tracks.length ? tracks.map((t, i) => `**${i + 1}.** ${t.title}`).join("\n") : "Hàng đợi trống.";
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("🎶 Hàng đợi").setDescription(queueList)] });
    }

    /* NOW PLAYING */
    if (command === "nowplaying" || command === "np") {
      const track = player.currentTrack;
      if (!track) return msg.reply("❌ Không có bài nào đang phát.");
      return msg.reply(`🎵 Đang phát: **${track.title}**`);
    }

  } catch (error) {
    console.error("🔥 ERROR:", error);
  }
});

/* =========================================================
   LOGIN & WEB SERVER FOR RENDER
========================================================= */

client.login(TOKEN);

const port = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot Discord Online 24/7!");
}).listen(port, () => {
  console.log(`🌐 Web server running on port ${port}`);
});
