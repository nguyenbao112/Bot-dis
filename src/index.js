import "dotenv/config";
import http from "http";
import https from "https";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
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
    new SoundCloudPlugin(),
    new TTSPlugin(),
    new InfinityPlugin(),
  ],
  autoCleanup: false,
  leaveOnEmpty: false,
  leaveOnEnd: false,
  extractorTimeout: 60000,
});

/* =========================================================
   HELPER: RESOLVE SHORT LINK SOUNDCLOUD & FORMAT TIME
========================================================= */

const resolveUrl = (url) => {
  return new Promise((resolve) => {
    if (!url.includes("on.soundcloud.com")) return resolve(url);

    const clientReq = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(res.headers.location.split("?")[0]);
      }
      resolve(url);
    });

    clientReq.on("error", () => resolve(url));
    clientReq.setTimeout(5000, () => {
      clientReq.destroy();
      resolve(url);
    });
  });
};

const formatDuration = (ms) => {
  if (!ms || Number.isNaN(ms)) return "Live / Unknown";
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));

  const pad = (n) => (n < 10 ? `0${n}` : n);
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

/* =========================================================
   READY
========================================================= */

client.once(Events.ClientReady, (readyClient) => {
  console.log("========================================");
  console.log("🤖 BOT MUSIC ĐÃ ONLINE SẴN SÀNG");
  console.log(`👤 ${readyClient.user.tag}`);
  console.log("🎵 Nguồn hỗ trợ: YouTube, Spotify, SoundCloud, Infinity");
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

  // Xóa bảng Now Playing cũ nếu có
  if (player.nowPlayingMessage) {
    try {
      await player.nowPlayingMessage.delete();
    } catch (e) {}
    player.nowPlayingMessage = null;
  }

  // Tải thông tin người yêu cầu bài hát
  let requesterName = "Unknown";
  if (track?.requestedBy) {
    try {
      const user = await client.users.fetch(track.requestedBy);
      requesterName = user.username;
    } catch (e) {
      requesterName = track.requestedBy;
    }
  }

  const textChannel = player.textChannel || client.channels.cache.get(player.textChannelId);
  if (!textChannel) return;

  const trackName = track?.title || "Unknown Track";
  const embed = new EmbedBuilder()
    .setColor("#2b2d31")
    .setTitle("🎶 Now Playing")
    .setDescription(`**[${trackName}](${track?.url || "#"})**`)
    .addFields(
      { name: "Duration", value: `\`${formatDuration(track?.duration)}\``, inline: false },
      { name: "Requested by", value: `${requesterName}`, inline: false }
    )
    .setFooter({ text: "Music Player Controls" });

  if (track?.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_pause_resume")
      .setLabel("Pause / Resume")
      .setEmoji("⏯️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_skip")
      .setLabel("Skip")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("btn_stop")
      .setLabel("End Session")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger)
  );

  try {
    const response = await textChannel.send({
      embeds: [embed],
      components: [row],
    });

    player.nowPlayingMessage = response;

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: track?.duration || 3600000,
    });

    collector.on("collect", async (interaction) => {
      const p = manager.get(player.guildId);
      if (!p) {
        return interaction.reply({ content: "❌ Không tìm thấy trình phát nhạc.", ephemeral: true });
      }

      // Phân quyền nút bấm: Chỉ người đã yêu cầu bài hát mới được sử dụng
      const currentReq = p.currentTrack?.requestedBy;
      if (currentReq && currentReq !== interaction.user.id) {
        return interaction.reply({ 
          content: "🔒 Chỉ người đã yêu cầu bài hát này mới có quyền sử dụng các nút điều khiển!", 
          ephemeral: true 
        });
      }

      if (interaction.customId === "btn_pause_resume") {
        if (p.isPaused) {
          p.resume();
          await interaction.reply({ content: "▶️ Đã tiếp tục phát nhạc.", ephemeral: true });
        } else {
          p.pause();
          await interaction.reply({ content: "⏸️ Đã tạm dừng phát nhạc.", ephemeral: true });
        }
      } else if (interaction.customId === "btn_skip") {
        await interaction.deferUpdate();
        p.skip();
      } else if (interaction.customId === "btn_stop") {
        p.stop();
        await interaction.reply({ content: "⏹️ Đã dừng phát nhạc và xóa hàng đợi.", ephemeral: true });
      }
    });
  } catch (err) {
    console.error("❌ Error sending Now Playing embed:", err);
  }
});

manager.on("trackEnd", (player, track) => {
  console.log(`[${player.guildId}] ⏹️ Kết thúc: ${track?.title || "Unknown"}`);
});

manager.on("queueEnd", async (player) => {
  console.log(`[${player.guildId}] 📭 Hàng đợi đã hết.`);
  if (player.nowPlayingMessage) {
    try {
      await player.nowPlayingMessage.delete();
    } catch (e) {}
    player.nowPlayingMessage = null;
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
        .setDescription("Tiền tố lệnh là: `B.`\nTrình phát hỗ trợ các nguồn: **YouTube, Spotify, SoundCloud, Infinity**.")
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
      player.textChannel = msg.channel;
      player.textChannelId = msg.channel.id;
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

        if (searchQuery.includes("on.soundcloud.com")) {
          searchQuery = await resolveUrl(searchQuery);
        }

        const isUrl = searchQuery.startsWith("http://") || searchQuery.startsWith("https://");

        if ((command === "scplay" || command === "sc") && !isUrl && !searchQuery.startsWith("scsearch:")) {
          searchQuery = `scsearch:${searchQuery}`;
        }

        const result = await activePlayer.play(searchQuery, msg.author.id);

        if (result?.type === "PLAYLIST" || Array.isArray(result?.tracks)) {
          const count = result?.tracks?.length || 0;
          await replyMsg.edit({ content: `🎶 Đã thêm playlist **${count} bài** vào hàng đợi.` });
        } else {
          // Lấy chính xác bài hát vừa được thêm vào cuối hàng đợi (hoặc bài đang phát nếu là bài đầu tiên)
          const upcoming = activePlayer.upcomingTracks || [];
          const addedTrack = upcoming.length > 0 ? upcoming[upcoming.length - 1] : (result?.track || activePlayer.currentTrack);
          const trackName = addedTrack?.title;

          if (!trackName) {
            await replyMsg.edit({ content: "❌ Không tìm thấy thông tin bài hát từ đường link này." });
          } else {
            await replyMsg.edit({ content: `🎶 Đã thêm **${trackName}** vào hàng đợi.` });
          }
        }

        return;
      } catch (error) {
        console.error("❌ PLAY ERROR:", error);
        return replyMsg.edit({ content: "❌ Không thể tải/phát bài hát này." });
      }
    }

    if (!player) return msg.reply("❌ Hiện tại bot chưa hoạt động trong Server này.");

    // Helper kiểm tra quyền sở hữu bài hát cho các lệnh văn bản
    const checkRequesterPermission = () => {
      const currentTrack = player.currentTrack;
      if (!currentTrack) return { allowed: false, reason: "❌ Không có bài hát nào đang phát." };
      if (currentTrack.requestedBy !== msg.author.id) {
        return { allowed: false, reason: "🔒 Chỉ người đã yêu cầu bài hát này mới có quyền thực hiện!" };
      }
      return { allowed: true };
    };

    /* PAUSE */
    if (command === "pause") {
      if (!player.isPlaying) return msg.reply("❌ Nhạc không đang phát.");
      const check = checkRequesterPermission();
      if (!check.allowed) return msg.reply(check.reason);

      player.pause();
      return msg.reply("⏸️ Đã tạm dừng.");
    }

    /* RESUME */
    if (command === "resume") {
      if (!player.isPaused) return msg.reply("❌ Nhạc đang phát rồi.");
      const check = checkRequesterPermission();
      if (!check.allowed) return msg.reply(check.reason);

      player.resume();
      return msg.reply("▶️ Đã phát tiếp.");
    }

    /* SKIP */
    if (command === "skip" || command === "s") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice để sử dụng lệnh này.");
      const check = checkRequesterPermission();
      if (!check.allowed) return msg.reply(check.reason);

      player.skip();
      return msg.reply(`⏭️ **${msg.author.displayName}** đã bỏ qua bài hát!`);
    }

    /* STOP */
    if (command === "stop") {
      const check = checkRequesterPermission();
      if (!check.allowed) return msg.reply(check.reason);

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
