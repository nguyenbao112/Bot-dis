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
import { YouTubePlugin, SpotifyPlugin } from "@ziplayer/plugin";
import { InfinityPlugin } from "@ziplayer/infinity";

// 1. Khởi tạo HTTP Server duy trì kết nối cho Render Web Service
const PORT = process.env.PORT || 10000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ZiPlayer Bot is running perfectly!");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Web server đang chạy ở cổng ${PORT}`);
  });

// 2. Cấu hình Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// 3. Khởi tạo PlayerManager với InfinityPlugin làm nguồn phát dự phòng chính
const manager = new PlayerManager({
  plugins: [
    new InfinityPlugin(),
    new YouTubePlugin({
      highWaterMark: 1 << 24,
      quality: "highestaudio",
    }),
    new SpotifyPlugin(),
  ],
  autoCleanup: true,
  extractorTimeout: 30000,
  enableSearchCache: true,
});

// 4. Đăng ký sự kiện hệ thống
manager.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle("🎶 Đang Phát Bài Hát")
    .setDescription(`**[${track.title}](${track.url})**`)
    .setThumbnail(track.thumbnail || null)
    .addFields(
      {
        name: "⏱ Thời lượng",
        value: track.isLive ? "🔴 Trực tiếp" : formatMs(track.duration),
        inline: true,
      },
      { name: "📻 Nguồn", value: (track.source || "Unknown").toUpperCase(), inline: true },
      { name: "👤 Người yêu cầu", value: track.requestedBy ? `<@${track.requestedBy}>` : "Tự động", inline: true }
    );

  await channel.send({ embeds: [embed] }).catch(() => null);
});

manager.on("queueEnd", async (player) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setDescription("✅ Hàng đợi đã kết thúc. Bot đã rời phòng thoại."),
      ],
    }).catch(() => null);
  }
});

manager.on("playerError", async (player, error, track) => {
  console.error("Lỗi trình phát:", error?.message || error);
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setDescription(`❌ Lỗi bài hát **${track?.title || "Không rõ"}**: \`${error?.message || "Không thể tải luồng phát"}\``),
      ],
    }).catch(() => null);
  }
});

// 5. Xử lý lệnh điều khiển
client.on(Events.ClientReady, () => {
  console.log(`🤖 Bot kết nối thành công: ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guildId || msg.author.bot || !msg.content.startsWith("!")) return;

  const args = msg.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const query = args.join(" ");
  const member = msg.member;
  const voiceChannel = member?.voice?.channel;

  // Hàm khởi tạo Player với cấu hình chống lag và cân bằng âm lượng
  async function getOrCreatePlayer() {
    const p = await manager.create(msg.guildId, {
      lowPerformance: false,
      preload: { enabled: true, autoDisableInLowPerformance: true },
      crossfade: { autoEnable: true, autoDisableInLowPerformance: true, durationMs: 4000 },
      smartTransition: {
        enabled: true,
        genreAware: true,
        beatAlign: true,
        baseDurationMs: 4000,
      },
      antiStuck: {
        enabled: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        reusePreloadFirst: true,
        reduceQualityOnRetry: true,
        controlledSkipThreshold: 3,
      },
      loudnessNormalization: {
        enabled: true,
        targetLUFS: -14,
        limiterCeiling: 0.95,
      },
    });
    p.textChannelId = msg.channelId;
    return p;
  }

  function hasPermission(player) {
    const currentTrack = player?.currentTrack;
    if (!currentTrack) return true;
    
    const isRequester = currentTrack.requestedBy === msg.author.id;
    const isMod = member.permissions.has(PermissionFlagsBits.ManageChannels);
    return isRequester || isMod;
  }

  const reply = (content, isError = false) => {
    const embed = new EmbedBuilder()
      .setColor(isError ? 0xef4444 : 0x6366f1)
      .setDescription(content);
    return msg.reply({ embeds: [embed] }).catch(() => null);
  };

  switch (command) {
    case "play":
    case "p": {
      if (!voiceChannel) return reply("❌ Bạn phải tham gia một kênh thoại trước!", true);
      if (!query) return reply("❌ Vui lòng nhập tên bài hát hoặc liên kết!", true);

      const loadingMsg = await msg.reply("🔎 Đang tìm kiếm bài hát...").catch(() => null);
      const player = await getOrCreatePlayer();

      if (!player.connection) {
        await player.connect(voiceChannel);
      }

      const prevQueueSize = player.queueSize;
      const wasPlaying = player.isPlaying;

      const success = await player.play(query, msg.author.id).catch(() => false);

      if (loadingMsg) loadingMsg.delete().catch(() => null);

      if (!success) {
        return reply("❌ Không tìm thấy bài hát hoặc lỗi phát sinh!", true);
      }

      if (wasPlaying) {
        reply(`➕ Đã thêm bài hát vào hàng đợi (vị trí **#${prevQueueSize + 1}**)!`);
      } else {
        reply(`▶️ Bắt đầu phát bài hát!`);
      }
      break;
    }

    case "insert": {
      if (!voiceChannel) return reply("❌ Bạn phải tham gia một kênh thoại trước!", true);
      if (!query) return reply("❌ Vui lòng nhập tên bài hát!", true);

      const player = await getOrCreatePlayer();
      if (!player.connection) await player.connect(voiceChannel);

      const success = await player.insert(query, 0, msg.author.id).catch(() => false);
      if (success) {
        reply(`📥 Đã chèn bài hát vào ngay vị trí tiếp theo!`);
      } else {
        reply(`❌ Không thể chèn bài hát này!`, true);
      }
      break;
    }

    case "stop": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Không có nhạc đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Bạn không có quyền dừng phát nhạc!", true);

      player.stop();
      return reply("⏹ Đã dừng phát nhạc và xóa hàng đợi!");
    }

    case "skip":
    case "s": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Không có nhạc đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Bạn không có quyền bỏ qua bài này!", true);

      player.skip();
      return reply("⏭ Đã bỏ qua bài hát!");
    }

    case "previous":
    case "prev": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Trình phát nhạc chưa bật!", true);

      const success = await player.previous().catch(() => false);
      if (success) {
        return reply("⏮ Đã quay lại bài hát trước đó!");
      } else {
        return reply("❌ Không có lịch sử bài hát trước đó!", true);
      }
    }

    case "pause": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Không có bài hát nào đang phát!", true);

      player.pause();
      return reply("⏸ Đã tạm dừng phát nhạc.");
    }

    case "resume":
    case "r": {
      const player = manager.get(msg.guildId);
      if (!player?.isPaused) return reply("❌ Nhạc không ở trạng thái tạm dừng!", true);

      player.resume();
      return reply("▶️ Đã tiếp tục phát nhạc.");
    }

    case "shuffle": {
      const player = manager.get(msg.guildId);
      if (!player || player.queueSize === 0) return reply("❌ Hàng đợi đang trống!", true);

      player.shuffle();
      return reply("🔀 Đã xáo trộn danh sách phát!");
    }

    case "loop": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Trình phát nhạc chưa được bật!", true);

      const mode = query.toLowerCase();
      if (!["off", "track", "queue"].includes(mode)) {
        return reply("❌ Chế độ lặp không hợp lệ! Hãy dùng: `!loop off`, `!loop track`, hoặc `!loop queue`", true);
      }

      const updatedMode = player.loop(mode);
      return reply(`🔁 Đã đặt chế độ lặp thành: **${updatedMode}**`);
    }

    case "volume":
    case "vol": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Trình phát chưa được bật!", true);

      const vol = parseInt(query);
      if (isNaN(vol) || vol < 0 || vol > 200) return reply("❌ Âm lượng phải từ 0 đến 200!", true);

      player.setVolume(vol);
      return reply(`🔊 Âm lượng được chỉnh thành: **${vol}%**`);
    }

    case "queue":
    case "q": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Trình phát chưa khởi tạo!", true);

      const current = player.currentTrack;
      const upcoming = player.upcomingTracks.slice(0, 10);

      if (!current && upcoming.length === 0) return reply("📋 Danh sách phát đang trống!");

      const embed = new EmbedBuilder().setColor(0x6366f1).setTitle("📋 Hàng Đợi Phát Nhạc");
      if (current) {
        embed.addFields({
          name: "▶️ Đang phát",
          value: `**[${current.title}](${current.url})** - Yêu cầu bởi <@${current.requestedBy}>`,
        });
      }
      if (upcoming.length > 0) {
        embed.addFields({
          name: "⏭ Bài tiếp theo",
          value: upcoming.map((t, i) => `\`${i + 1}.\` ${t.title}`).join("\n"),
        });
      }
      return msg.reply({ embeds: [embed] });
    }

    case "nowplaying":
    case "np": {
      const player = manager.get(msg.guildId);
      if (!player?.currentTrack) return reply("❌ Không có bài hát nào đang phát!", true);

      const track = player.currentTrack;
      const progress = player.getProgressBar({ size: 15 });
      const time = player.getTime();

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle("🎵 Bài Hát Đang Phát")
        .setDescription(`**[${track.title}](${track.url})**\n\`${progress}\`\n⏱ ${time.formatted.current} / ${time.formatted.total}`)
        .setThumbnail(track.thumbnail || null);

      return msg.reply({ embeds: [embed] });
    }
  }
});

function formatMs(ms) {
  if (!ms) return "00:00";
  const sec = Math.floor((ms / 1000) % 60);
  const min = Math.floor((ms / (1000 * 60)) % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(min)}:${pad(sec)}`;
}

client.login(process.env.DISCORD_TOKEN);
