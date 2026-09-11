import "dotenv/config";
import http from "http";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  Events,
} from "discord.js";
import { PlayerManager } from "ziplayer";[span_2](start_span)[span_2](end_span)
import { YouTubePlugin, SpotifyPlugin } from "@ziplayer/plugin";[span_3](start_span)[span_3](end_span)
import { InfinityPlugin } from "@ziplayer/infinity";[span_4](start_span)[span_4](end_span)

/* =========================================================
   1. KHỞI TẠO HTTP SERVER (ĐỂ RENDER FREE KHÔNG LỖI PORT)
========================================================= */
const PORT = process.env.PORT || 10000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ZiPlayer Bot is running perfectly!");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Web server HTTP đang chạy trên cổng ${PORT}`);
  });

/* =========================================================
   2. KHỞI TẠO CLIENT & PLAYER MANAGER (CÓ FALLBACK PLUGIN)
========================================================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Sử dụng InfinityPlugin đứng trước để làm dự phòng khi YouTube bị chặn IP trên Render Free[span_5](start_span)[span_5](end_span)
const manager = new PlayerManager({
  plugins: [
    new InfinityPlugin(),
    new YouTubePlugin({
      highWaterMark: 1 << 24,
      quality: "highestaudio",
    }),
    new SpotifyPlugin(),
  ],
  autoCleanup: true,[span_6](start_span)[span_6](end_span)
  extractorTimeout: 30000,[span_7](start_span)[span_7](end_span)
  enableSearchCache: true,[span_8](start_span)[span_8](end_span)
});

/* =========================================================
   3. SỰ KIỆN TRÌNH PHÁT NHẠC (PLAYER EVENTS)
========================================================= */
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
      { name: "👤 Người yêu cầu", value: `<@${track.requestedBy}>`, inline: true }
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
          .setDescription("✅ Hàng đợi đã kết thúc. Bot đã rời kênh thoại."),
      ],
    }).catch(() => null);
  }
});

manager.on("playerError", async (player, error, track) => {
  console.error("Lỗi bài hát:", error?.message || error);
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setDescription(`❌ Lỗi tải bài hát **${track?.title || "Không rõ"}**: \`${error?.message || "Tệp âm thanh bị lỗi"}\``),
      ],
    }).catch(() => null);
  }
});

/* =========================================================
   4. SỰ KIỆN TIN NHẮN & ĐIỀU KHUYỂN
========================================================= */
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

  // Hàm tạo player tối ưu RAM cho máy chủ Render[span_9](start_span)[span_9](end_span)
  async function getOrCreatePlayer() {
    const p = await manager.create(msg.guildId, {
      lowPerformance: true, // Auto disable crossfade và preload để tránh tràn RAM[span_10](start_span)[span_10](end_span)
      antiStuck: {
        enabled: true,[span_11](start_span)[span_11](end_span)
        maxRetries: 3,[span_12](start_span)[span_12](end_span)
        retryDelayMs: 1000,[span_13](start_span)[span_13](end_span)
      },
    });
    p.textChannelId = msg.channelId;
    return p;
  }

  // CHỨC NĂNG BẢO VỆ: CHỈ NGƯỜI PHÁT HOẶC MOD MỚI ĐƯỢC TÁC ĐỘNG
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
      if (!voiceChannel) return reply("❌ Bạn phải vào một kênh thoại trước!", true);
      if (!query) return reply("❌ Vui lòng nhập tên bài hát hoặc liên kết!", true);

      const loadingMsg = await msg.reply("🔎 Đang tìm kiếm và xử lý bài hát...").catch(() => null);
      const player = await getOrCreatePlayer();

      if (!player.connection) {
        await player.connect(voiceChannel);
      }

      const prevQueueSize = player.queueSize;
      const wasPlaying = player.isPlaying;

      const success = await player.play(query, msg.author.id).catch(() => false);

      if (!success) {
        if (loadingMsg) loadingMsg.delete().catch(() => null);
        return reply("❌ Không thể lấy dữ liệu bài hát từ liên kết/từ khóa này!", true);
      }

      if (loadingMsg) loadingMsg.delete().catch(() => null);

      if (wasPlaying) {
        reply(`➕ Đã thêm bài hát mới vào hàng đợi (vị trí số **${prevQueueSize + 1}**)!`);
      } else {
        reply(`▶️ Đã bắt đầu phát bài hát theo yêu cầu của bạn!`);
      }
      break;
    }

    case "stop": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Hiện không có bài hát nào đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người yêu cầu bài hát hiện tại** hoặc **Quản trị viên** mới được dùng lệnh này!", true);

      player.stop();[span_14](start_span)[span_14](end_span)
      return reply("⏹ Đã dừng phát nhạc và xóa toàn bộ hàng đợi!");
    }

    case "skip":
    case "s": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Hiện không có bài hát nào đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người yêu cầu bài hát hiện tại** hoặc **Quản trị viên** mới được bỏ qua bài hát!", true);

      player.skip();[span_15](start_span)[span_15](end_span)
      return reply("⏭ Đã chuyển sang bài hát tiếp theo!");
    }

    case "pause": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Không có bài hát nào đang phát để tạm dừng!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người yêu cầu bài hát hiện tại** hoặc **Quản trị viên** mới được tạm dừng!", true);

      player.pause();[span_16](start_span)[span_16](end_span)
      return reply("⏸ Đã tạm dừng bài hát.");
    }

    case "resume":
    case "r": {
      const player = manager.get(msg.guildId);
      if (!player?.isPaused) return reply("❌ Trình phát nhạc không ở trạng thái tạm dừng!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người yêu cầu bài hát hiện tại** hoặc **Quản trị viên** mới được tiếp tục!", true);

      player.resume();[span_17](start_span)[span_17](end_span)
      return reply("▶️ Đã tiếp tục phát nhạc.");
    }

    case "seek": {
      const player = manager.get(msg.guildId);
      if (!player?.currentTrack) return reply("❌ Không có bài hát nào đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người yêu cầu bài hát hiện tại** hoặc **Quản trị viên** mới được tua bài hát!", true);

      const seconds = parseInt(query);
      if (isNaN(seconds)) return reply("❌ Vui lòng nhập số giây hợp lệ. Ví dụ: `!seek 60`", true);

      await player.seek(seconds * 1000);[span_18](start_span)[span_18](end_span)
      return reply(`⏩ Đã tua đến vị trí **${seconds}s**.`);
    }

    case "queue":
    case "q": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Kênh thoại chưa bật trình phát nhạc!", true);

      const current = player.currentTrack;[span_19](start_span)[span_19](end_span)
      const upcoming = player.upcomingTracks.slice(0, 10);[span_20](start_span)[span_20](end_span)

      if (!current && upcoming.length === 0) return reply("📋 Hàng đợi hiện tại đang trống!");

      const embed = new EmbedBuilder().setColor(0x6366f1).setTitle("📋 Danh Sách Phát Nhạc");
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
      if (!player?.currentTrack) return reply("❌ Không có nhạc đang phát!", true);

      const track = player.currentTrack;[span_21](start_span)[span_21](end_span)
      const progress = player.getProgressBar({ size: 15 });[span_22](start_span)[span_22](end_span)
      const time = player.getTime();[span_23](start_span)[span_23](end_span)

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle("🎵 Bài Hát Đang Phát")
        .setDescription(`**[${track.title}](${track.url})**\n\`${progress}\`\n⏱ ${time.formatted.current} / ${time.formatted.total}`)[span_24](start_span)[span_24](end_span)
        .setThumbnail(track.thumbnail || null);

      return msg.reply({ embeds: [embed] });
    }

    case "volume":
    case "vol": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Trình phát nhạc chưa khởi tạo!", true);

      const vol = parseInt(query);
      if (isNaN(vol) || vol < 0 || vol > 200) return reply("❌ Mức âm lượng từ 0 đến 200!", true);

      player.setVolume(vol);[span_25](start_span)[span_25](end_span)
      return reply(`🔊 Đã chỉnh âm lượng thành **${vol}%**`);
    }

    case "loop": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Trình phát nhạc chưa khởi tạo!", true);

      const mode = query.toLowerCase();
      if (!["off", "track", "queue"].includes(mode)) return reply("❌ Các chế độ hợp lệ: `off`, `track`, `queue`", true);

      player.loop(mode);[span_26](start_span)[span_26](end_span)
      return reply(`🔁 Đã đổi chế độ lặp sang: **${mode}**`);
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

client.login(process.env.DISCORD_TOKEN);[span_27](start_span)[span_27](end_span)
