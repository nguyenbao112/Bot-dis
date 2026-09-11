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

// 1. Khởi tạo HTTP Server tránh Render ngắt kết nối Web Service
const PORT = process.env.PORT || 10000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ZiPlayer Bot is online!");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Web server đang chạy ở cổng ${PORT}`);
  });

// 2. Cấu hình Discord Client & ZiPlayer Manager
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

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

// 3. Xử lý các sự kiện âm thanh
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
          .setDescription(`❌ Lỗi bài hát **${track?.title || "Không rõ"}**: \`${error?.message || "Tệp âm thanh bị lỗi"}\``),
      ],
    }).catch(() => null);
  }
});

// 4. Lệnh điều khiển Bot
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

  async function getOrCreatePlayer() {
    const p = await manager.create(msg.guildId, {
      lowPerformance: true,
      antiStuck: {
        enabled: true,
        maxRetries: 3,
        retryDelayMs: 1000,
      },
    });
    p.textChannelId = msg.channelId;
    return p;
  }

  // Kiểm tra quyền: Chỉ người mở bài hoặc Quản trị viên channel mới được tác động
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
        return reply("❌ Không thể tải bài hát này!", true);
      }

      if (loadingMsg) loadingMsg.delete().catch(() => null);

      if (wasPlaying) {
        reply(`➕ Đã thêm bài hát vào hàng đợi (vị trí **#${prevQueueSize + 1}**)!`);
      } else {
        reply(`▶️ Đã bắt đầu phát bài hát!`);
      }
      break;
    }

    case "stop": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Hiện không có bài hát nào đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người mở bài hát** hoặc **Quản trị viên** mới có quyền dừng!", true);

      player.stop();
      return reply("⏹ Đã dừng phát nhạc và xóa danh sách phát!");
    }

    case "skip":
    case "s": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Hiện không có bài hát nào đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người mở bài hát** hoặc **Quản trị viên** mới có quyền bỏ qua!", true);

      player.skip();
      return reply("⏭ Đã chuyển bài tiếp theo!");
    }

    case "pause": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply("❌ Không có bài hát nào đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người mở bài hát** hoặc **Quản trị viên** mới được tạm dừng!", true);

      player.pause();
      return reply("⏸ Đã tạm dừng bài hát.");
    }

    case "resume":
    case "r": {
      const player = manager.get(msg.guildId);
      if (!player?.isPaused) return reply("❌ Trình phát nhạc không ở trạng thái tạm dừng!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người mở bài hát** hoặc **Quản trị viên** mới được tiếp tục!", true);

      player.resume();
      return reply("▶️ Đã tiếp tục phát nhạc.");
    }

    case "seek": {
      const player = manager.get(msg.guildId);
      if (!player?.currentTrack) return reply("❌ Không có bài hát nào đang phát!", true);
      if (!hasPermission(player)) return reply("⛔ Chỉ **người mở bài hát** hoặc **Quản trị viên** mới được tua nhạc!", true);

      const seconds = parseInt(query);
      if (isNaN(seconds)) return reply("❌ Vui lòng nhập số giây hợp lệ (Ví dụ: `!seek 60`)", true);

      await player.seek(seconds * 1000);
      return reply(`⏩ Đã tua đến mốc **${seconds}s**.`);
    }

    case "queue":
    case "q": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Kênh thoại chưa bật trình phát nhạc!", true);

      const current = player.currentTrack;
      const upcoming = player.upcomingTracks.slice(0, 10);

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

    case "volume":
    case "vol": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Trình phát nhạc chưa khởi tạo!", true);

      const vol = parseInt(query);
      if (isNaN(vol) || vol < 0 || vol > 200) return reply("❌ Âm lượng hợp lệ từ 0 đến 200!", true);

      player.setVolume(vol);
      return reply(`🔊 Âm lượng: **${vol}%**`);
    }

    case "loop": {
      const player = manager.get(msg.guildId);
      if (!player) return reply("❌ Trình phát nhạc chưa khởi tạo!", true);

      const mode = query.toLowerCase();
      if (!["off", "track", "queue"].includes(mode)) return reply("❌ Chế độ hợp lệ: `off`, `track`, `queue`", true);

      player.loop(mode);
      return reply(`🔁 Đã chuyển chế độ lặp: **${mode}**`);
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
