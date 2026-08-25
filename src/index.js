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
   CONFIG & KEEP-ALIVE HTTP SERVER (RENDER PORT BINDING)
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!TOKEN) {
  console.error("❌ Không tìm thấy DISCORD_TOKEN hoặc TOKEN trong .env");
  process.exit(1);
}

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Bot Discord Online 24/7!");
});

server.listen(PORT, "0.0.0.0", () => {
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
  manager = new PlayerManager({
    plugins: [
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
  console.log("🎵 Nguồn hỗ trợ: YouTube, Spotify, Infinity");
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
        .setDescription("Tiền tố lệnh là: `!`\nTrình phát hỗ trợ các nguồn: **YouTube, Spotify, Infinity**.")
        .addFields(
          {
            name: "▶️ Phát Nhạc",
            value: 
              "`!play <tên bài/link>` (hoặc `!p`): Phát nhạc từ YT, Spotify...\n" +
              "`!scplay <tên bài/link>` (hoặc `!sc`): Tìm và phát nhạc từ SoundCloud.",
          },
          {
            name: "🎛️ Điều Khiển Trình Phát",
            value: 
              "`!pause`: Tạm dừng bài hát.\n" +
              "`!resume`: Tiếp tục phát nhạc.\n" +
              "`!skip` (hoặc `!s`): Bỏ qua bài hiện tại (Chỉ dành cho người yêu cầu).\n" +
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
      player.destroy();
      return msg.reply("👋 Bot đã rời phòng voice.");
    }

    /* PLAY / SCPLAY */
    if (command === "play" || command === "p" || command === "scplay" || command === "sc") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice trước.");
      if (!query) return msg.reply("❌ Dùng: `!play <tên bài/URL>` hoặc `!sc <tên bài hát SoundCloud>`");

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
   LOGIN
========================================================= */

client.login(TOKEN).catch((err) => {
  console.error("❌ LỖI LOGIN DISCORD:", err);
});
