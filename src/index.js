import "dotenv/config";
import http from "http";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
} from "discord.js";
import { PlayerManager } from "ziplayer";
import {
  YouTubePlugin,
  SpotifyPlugin,
  SoundCloudPlugin,
  TTSPlugin,
} from "@ziplayer/plugin";
import { InfinityPlugin } from "@ziplayer/infinity";

/* =========================================================
   CONFIG & KEEP-ALIVE SERVER (RENDER REQUIREMENT)
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!TOKEN) {
  console.error("❌ Không tìm thấy DISCORD_TOKEN hoặc TOKEN trong .env");
  process.exit(1);
}

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Bot Discord Online 24/7!");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

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
  rest: {
    timeout: 30000,
    retries: 5,
  },
});

/* =========================================================
   PLAYER MANAGER
========================================================= */

let manager;

const initPlayerManager = () => {
  if (manager) return;

  const scClientId = process.env.SOUNDCLOUD_CLIENT_ID || "iZGeft3Standard223849384938493";

  manager = new PlayerManager({
    plugins: [
      new SoundCloudPlugin({
        clientId: scClientId,
      }),
      new YouTubePlugin({
        playerClients: ["TVHTML5", "ANDROID", "IOS"],
      }),
      new SpotifyPlugin(),
      new TTSPlugin(),
      new InfinityPlugin(),
    ],
    autoCleanup: false,
    leaveOnEmpty: false,
    leaveOnEnd: false,
    extractorTimeout: 60000,
  });

  manager.on("trackStart", async (player, track) => {
    console.log(`[${player.guildId}] ▶️ Đang phát: ${track?.title || "Unknown"}`);
    await applyClarity(player);
  });

  manager.on("trackEnd", (player, track) => {
    console.log(`[${player.guildId}] ⏹️ Kết thúc: ${track?.title || "Unknown"}`);
  });

  manager.on("queueEnd", (player) => {
    console.log(`[${player.guildId}] 📭 Hàng đợi đã hết.`);
  });

  manager.on("playerError", (player, error, track) => {
    console.error("========================================");
    console.error(`❌ PLAYER ERROR [${player?.guildId || "unknown"}]`);
    console.error("Track:", track?.title || "Không xác định");
    console.error(error);
    console.error("========================================");
  });
};

/* =========================================================
   READY
========================================================= */

client.once(Events.ClientReady, (readyClient) => {
  initPlayerManager();
  console.log("========================================");
  console.log("🤖 BOT MUSIC ĐÃ ONLINE SẴN SÀNG");
  console.log(`👤 ${readyClient.user.tag}`);
  console.log("🎵 Nguồn hỗ trợ: SoundCloud, YouTube, Spotify, Infinity");
  console.log("========================================");
});

client.on("error", (err) => console.error("❌ Client Error:", err));

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
   MESSAGE COMMAND
========================================================= */

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.guildId || msg.author.bot || typeof msg.content !== "string" || !msg.content.startsWith("!")) return;

    const parts = msg.content.slice(1).trim().split(/\s+/);
    const command = parts.shift()?.toLowerCase();
    const query = parts.join(" ").trim();

    // Gộp tất cả nguồn phát chung vào play / p
    const musicCommands = [
      "help", "h", "play", "p", "pause", "resume", 
      "skip", "s", "stop", "volume", "vol", "filter", "clarity", 
      "queue", "q", "nowplaying", "np", "join", "leave"
    ];

    if (!musicCommands.includes(command)) return;

    /* HELP */
    if (command === "help" || command === "h") {
      const helpEmbed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("🎵 BẢNG HƯỚNG DẪN SỬ DỤNG BOT NHẠC")
        .setDescription("Tiền tố lệnh là: `!`\nTrình phát tự động nhận diện: **SoundCloud, YouTube, Spotify, Infinity**.")
        .addFields(
          {
            name: "▶️ Phát Nhạc (Tất cả nguồn)",
            value: "`!play <tên bài/link>` (hoặc `!p`): Phát nhạc tự động từ SoundCloud, YT, Spotify...",
          },
          {
            name: "🎛️ Quyền Điều Khiển (Chỉ Người Gọi Bài/Admin)",
            value: 
              "`!pause`: Tạm dừng bài hát.\n" +
              "`!resume`: Tiếp tục phát nhạc.\n" +
              "`!skip` (hoặc `!s`): Bỏ qua bài hát.\n" +
              "`!stop`: Dừng phát và xóa hàng đợi.\n" +
              "`!volume <0-200>` (hoặc `!vol`): Chỉnh âm lượng bot.",
          },
          {
            name: "✨ Tối Ưu Âm Thanh & Hàng Đợi",
            value: 
              "`!clarity` (hoặc `!filter`): Bật bộ lọc làm rõ âm thanh Clarity EQ.\n" +
              "`!queue` (hoặc `!q`): Xem danh sách hàng đợi 10 bài tiếp theo.\n" +
              "`!nowplaying` (hoặc `!np`): Xem bài hát đang phát.",
          },
          {
            name: "📌 Kênh Voice",
            value: 
              "`!join`: Cho bot vào phòng voice của bạn.\n" +
              "`!leave`: Cho bot rời phòng voice.",
          }
        )
        .setFooter({ text: "Chúc bạn nghe nhạc vui vẻ!" });

      return msg.reply({ embeds: [helpEmbed] });
    }

    if (!manager) initPlayerManager();

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

    /* HÀM KẾT NỐI VOICE AN TOÀN - CHỐNG XUNG ĐỘT RECONNECT */
    const connectToVoice = async (activePlayer, channel) => {
      if (!activePlayer.connection || activePlayer.connection.state?.status === "destroyed") {
        await activePlayer.connect(channel, {
          selfDeaf: true,
          group: client.user.id,
          adapterCreator: channel.guild.voiceAdapterCreator,
        });
      }
    };

    /* HÀM KIỂM TRA QUYỀN ĐIỀU KHIỂN (BẢO VỆ CHẶT CHẼ) */
    const isOwnerOrAdmin = () => {
      const currentTrack = player?.currentTrack;
      const isRequester = currentTrack?.requestedBy === msg.author.id;
      const isAdmin = msg.member?.permissions.has(PermissionFlagsBits.Administrator);
      return isRequester || isAdmin;
    };

    /* JOIN */
    if (command === "join") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice trước.");
      try {
        const activePlayer = await getOrCreatePlayer();
        await connectToVoice(activePlayer, voiceChannel);
        return msg.reply(`📌 Đã vào **${voiceChannel.name}**`);
      } catch (error) {
        console.error("❌ Lỗi JOIN Voice:", error);
        return msg.reply("❌ Không thể vào voice. Hãy kiểm tra quyền của Bot!");
      }
    }

    /* LEAVE (BẢO VỆ QUYỀN) */
    if (command === "leave") {
      if (!player) return msg.reply("❌ Bot chưa ở trong phòng voice.");
      if (!isOwnerOrAdmin()) return msg.reply("🔒 Chỉ người yêu cầu bài hát hiện tại hoặc Admin mới có quyền cho bot rời phòng!");
      player.destroy();
      return msg.reply("👋 Bot đã rời phòng voice.");
    }

    /* PLAY / P (GỘP CHUNG TẤT CẢ NGUỒN) */
    if (command === "play" || command === "p") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice trước.");
      if (!query) return msg.reply("❌ Dùng: `!play <tên bài/link SoundCloud, YT, Spotify>`");

      const activePlayer = await getOrCreatePlayer();

      try {
        await connectToVoice(activePlayer, voiceChannel);
      } catch (error) {
        console.error("❌ Lỗi KẾT NỐI VOICE:", error);
        if (!activePlayer.isPlaying && !activePlayer.currentTrack) {
          return msg.reply("❌ Không kết nối được voice. Kiểm tra lại quyền Connect/Speak của bot!");
        }
      }

      const replyMsg = await msg.reply("🔎 Đang tìm và tải nhạc...");

      try {
        let searchQuery = query.trim();

        // Tự động ưu tiên tìm SoundCloud nếu link chứa soundcloud.com
        if (searchQuery.includes("soundcloud.com") && !searchQuery.startsWith("http")) {
          searchQuery = `scsearch:${searchQuery}`;
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

    /* PAUSE (BẢO VỆ QUYỀN) */
    if (command === "pause") {
      if (!isOwnerOrAdmin()) return msg.reply("🔒 Chỉ người yêu cầu bài hát hoặc Admin mới có quyền tạm dừng!");
      if (!player.isPlaying) return msg.reply("❌ Nhạc không đang phát.");
      player.pause();
      return msg.reply("⏸️ Đã tạm dừng.");
    }

    /* RESUME (BẢO VỆ QUYỀN) */
    if (command === "resume") {
      if (!isOwnerOrAdmin()) return msg.reply("🔒 Chỉ người yêu cầu bài hát hoặc Admin mới có quyền tiếp tục!");
      if (!player.isPaused) return msg.reply("❌ Nhạc đang phát rồi.");
      player.resume();
      return msg.reply("▶️ Đã phát tiếp.");
    }

    /* SKIP (BẢO VỆ QUYỀN) */
    if (command === "skip" || command === "s") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice để sử dụng lệnh này.");
      if (!isOwnerOrAdmin()) return msg.reply("🔒 Chỉ người yêu cầu bài hát hiện tại hoặc Admin mới có quyền skip!");

      player.skip();
      return msg.reply(`⏭️ **${msg.author.displayName}** đã bỏ qua bài hát!`);
    }

    /* STOP (BẢO VỆ QUYỀN) */
    if (command === "stop") {
      if (!isOwnerOrAdmin()) return msg.reply("🔒 Chỉ người yêu cầu bài hát hiện tại hoặc Admin mới có quyền dừng phát!");
      player.stop();
      return msg.reply("⏹️ Đã dừng nhạc.");
    }

    /* VOLUME (BẢO VỆ QUYỀN) */
    if (command === "volume" || command === "vol") {
      if (!isOwnerOrAdmin()) return msg.reply("🔒 Chỉ người yêu cầu bài hát hiện tại hoặc Admin mới có quyền chỉnh âm lượng!");
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
   LOGIN
========================================================= */

client.login(TOKEN).catch((err) => {
  console.error("❌ LỖI LOGIN DISCORD:", err);
});
