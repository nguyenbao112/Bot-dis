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

/* =========================================================
   1. KIỂM TRA ĐIỀU KIỆN MÔI TRƯỜNG & KHỞI TẠO WEB SERVER
========================================================= */
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ LỖI NGHIÊM TRỌNG: Chưa cấu hình DISCORD_TOKEN trong Environment!");
  process.exit(1);
}

const PORT = process.env.PORT || 10000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ZiPlayer Bot Online 24/7!");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Web server running on port ${PORT}`);
  });

/* =========================================================
   2. XỬ LÝ COOKIE YOUTUBE NETSCAPE
========================================================= */
function parseNetscapeCookie(cookieRaw) {
  if (!cookieRaw) return "";
  if (!cookieRaw.includes("\t") && cookieRaw.includes("=")) {
    return cookieRaw.trim();
  }
  const lines = cookieRaw.split("\n");
  const cookies = [];
  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 7) {
      cookies.push(`${parts[5].trim()}=${parts[6].trim()}`);
    }
  }
  return cookies.join("; ");
}

const BACKUP_COOKIE = `.youtube.com	TRUE	/	TRUE	1787988280	GPS	1
.youtube.com	TRUE	/	TRUE	1822546590	PREF	f6=40000000&tz=Asia.Saigon
.youtube.com	TRUE	/	TRUE	1819522589	__Secure-1PSIDTS	sidts-CjUBXMw41YejFAqpzVEi3r8vWyT-8I0ttNYiDpkEDtAM32OrbZa9uSBj99NBIa6KlEOtdVQcHBAA
.youtube.com	TRUE	/	TRUE	1819522589	__Secure-3PSIDTS	sidts-CjUBXMw41YejFAqpzVEi3r8vWyT-8I0ttNYiDpkEDtAM32OrbZa9uSBj99NBIa6KlEOtdVQcHBAA
.youtube.com	TRUE	/	FALSE	1822546589	HSID	AlzGNN5GLQ_s5EZaY
.youtube.com	TRUE	/	TRUE	1822546589	SSID	AaH7WuLjIxpibBgiJ
.youtube.com	TRUE	/	FALSE	1822546589	APISID	Y6lNr8DXLZWr1ffQ/AjuUTSTDb4KlXQM5Y
.youtube.com	TRUE	/	TRUE	1822546589	SAPISID	YqxkU_WVEqnS-Nmw/ApOvtePEg2bsH5Jbs
.youtube.com	TRUE	/	TRUE	1822546589	__Secure-1PAPISID	YqxkU_WVEqnS-Nmw/ApOvtePEg2bsH5Jbs
.youtube.com	TRUE	/	TRUE	1822546589	__Secure-3PAPISID	YqxkU_WVEqnS-Nmw/ApOvtePEg2bsH5Jbs
.youtube.com	TRUE	/	FALSE	1822546589	SID	g.a000CAmi6X5l2br81ARbqb40pkXp7BrNKTGZyYQCpnur7CZVzGCPeaiAfccW8YV0g2QHXwkbdwACgYKAfwSARISFQHGX2MilDc0HmxxU10JBnB4aMZLuRoVAUF8yKoNfAwNijxtSK8T24yoN0810076
.youtube.com	TRUE	/	TRUE	1822546589	__Secure-1PSID	g.a000CAmi6X5l2br81ARbqb40pkXp7BrNKTGZyYQCpnur7CZVzGCPNA5MGdPr9Q7P4p1YS6ycZAACgYKAXQSARISFQHGX2MiPIgGlv_F4rVgOW7yqeJjbhoVAUF8yKovfghXmXc_BIbPN5mgaJNF0076
.youtube.com	TRUE	/	TRUE	1822546589	__Secure-3PSID	g.a000CAmi6X5l2br81ARbqb40pkXp7BrNKTGZyYQCpnur7CZVzGCPa1DxViXJFaQL_TkUU17m6QACgYKAa8SARISFQHGX2MiDTQbanLPNpOqd0S9IzkkyBoVAUF8yKoS9JGPILD374mqCBWXXJV30076
.youtube.com	TRUE	/	TRUE	1822546589	LOGIN_INFO	AFmmF2swRgIhAKJtaS7QJYyEjGqDL5joJpMi2QsCWyUbK8FL9nGVUVyaAiEAkFpenOac1UVe_HiQ3n7Uajfsj6P02n-Mtiaxirrp5DQ:QUQ3MjNmejR4alpITXQ5ajZZN1hkTFJ4NDVicDhBZEp6cHhTTFRkc09ZRFl5TGxhOWZaa0pGbS1MQzdtaG9aVUxJM1JLU2U3TEVXbTlBbTlkSXVkUWUtdGZYeVdQaWt1YVBBOFJHUEdZaGx4MHdscWdKUy11MlkyallwTk5pTUl3YkVZMjZ6TGpYZEVIckpsRnY2Z2N6d1ZYU3VDeEZnZTZ3
.youtube.com	TRUE	/	FALSE	1819522592	SIDCC	AKEyXzU01kp87k0-3TKE-i_h300LKlB-bZF-f8_K4hXvBXqto2B6dfRzQVzlDYDswlZ0bTTx
.youtube.com	TRUE	/	TRUE	1819522592	__Secure-1PSIDCC	AKEyXzWw3Hoa4EM24wj6_s8iq-rwq0V5dQ69sn93oFxpj_MZ31fUrPBcM4RNK39DdI7LL3jYZQ
.youtube.com	TRUE	/	TRUE	1819522592	__Secure-3PSIDCC	AKEyXzWQ5tfbJbjMn0Kf-0s0xhi--amIqm4umYo3Mef7pRQZX1Ii1_PAroJCLFgt4aDrFORvlA`;

const FORMATTED_COOKIE = parseNetscapeCookie(process.env.YT_COOKIE || BACKUP_COOKIE);

/* =========================================================
   3. HÀM TRỢ GIÚP & CHUẨN HÓA DỮ LIỆU
========================================================= */
function errEmbed(message) {
  return new EmbedBuilder().setColor(0xef4444).setDescription(`❌ ${message}`);
}

function formatDuration(ms) {
  if (!ms || isNaN(ms)) return "00:00";
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const pad = (num) => String(num).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function cleanQuery(input) {
  if (!input) return input;
  let clean = input.trim();
  if (clean.includes("youtu.be/")) {
    const id = clean.split("youtu.be/")[1].split("?")[0].split("&")[0];
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (clean.includes("youtube.com") || clean.includes("youtu.be")) {
    try {
      const url = new URL(clean);
      url.searchParams.delete("si");
      url.searchParams.delete("pp");
      return url.toString();
    } catch {
      return clean.split("?si=")[0];
    }
  }
  return clean;
}

/* =========================================================
   4. KHỞI TẠO PLAYER MANAGER VỚI CẤU HÌNH CẮT GỌM RAM/CPU
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

const manager = new PlayerManager({
  plugins: [
    new YouTubePlugin({
      highWaterMark: 1 << 25,
      quality: "highestaudio",
      cookies: FORMATTED_COOKIE,
      sabrOptions: { enabled: false },
      ytdlOptions: {
        filter: "audioonly",
        quality: "highestaudio",
        highWaterMark: 1 << 25,
        dlChunkSize: 0,
        requestOptions: {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Cookie: FORMATTED_COOKIE,
          },
        },
      },
    }),
    new SpotifyPlugin(),
    new InfinityPlugin(),
  ],
  autoCleanup: true,
  extractorTimeout: 30000,
  enableSearchCache: true,
});

/* =========================================================
   5. EVENT LISTENER PHÁT NHẠC KHÔNG TRÔI SỰ KIỆN
========================================================= */
manager.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (!channel) return;

  const requester = await client.users.fetch(track.requestedBy).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle("🎵 Đang Phát Bài Hát")
    .setDescription(`**[${track.title}](${track.url})**`)
    .setThumbnail(track.thumbnail ?? null)
    .addFields(
      {
        name: "⏱ Thời lượng",
        value: track.isLive ? "🔴 Trực tiếp" : formatDuration(track.duration),
        inline: true,
      },
      { name: "📻 Nguồn", value: track.source?.toUpperCase() || "UNKNOWN", inline: true },
      { name: "👤 Người yêu cầu", value: requester ? requester.tag : "Không rõ", inline: true }
    )
    .setFooter({ text: "ZiPlayer Core Engine • Optimized for Render Free" });

  await channel.send({ embeds: [embed] });
});

manager.on("queueEnd", async (player) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setDescription("✅ Hàng đợi đã kết thúc. Bot đã rời kênh thoại."),
      ],
    });
  }
});

manager.on("playerError", async (player, error, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Lỗi Trình Phát Nhạc")
          .setDescription(`Không thể tải bài: **${track?.title ?? "Unknown"}**\n\`${error.message}\``),
      ],
    });
  }
});

/* =========================================================
   6. BỘ LỆNH ĐẦY ĐỦ CHO DISCORD BOT
========================================================= */
client.on(Events.ClientReady, () => {
  console.log(`🤖 Bot sẵn sàng dưới tên: ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guildId || msg.author.bot) return;
  if (!msg.content.startsWith("!")) return;

  const args = msg.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const query = args.join(" ");
  const member = msg.member;
  const voiceChannel = member?.voice?.channel;

  async function getPlayer() {
    const p = await manager.create(msg.guildId, {
      lowPerformance: true,
      preload: { enabled: true, autoDisableInLowPerformance: false },
      crossfade: { enabled: false },
      smartTransition: { enabled: false },
      antiStuck: {
        enabled: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        reduceQualityOnRetry: true,
      },
      loudnessNormalization: { enabled: false },
    });
    p.textChannelId = msg.channelId;
    return p;
  }

  function checkPermission(player) {
    const track = player?.currentTrack;
    if (!track) return false;
    const isRequester = track.requestedBy === msg.author.id;
    const isMod = member.permissions.has(PermissionFlagsBits.ManageChannels);
    return isRequester || isMod;
  }

  const reply = (embed) => msg.reply({ embeds: [embed] });

  switch (command) {
    case "play":
    case "p": {
      if (!voiceChannel) return reply(errEmbed("Bạn phải tham gia một kênh thoại trước!"));
      if (!query) return reply(errEmbed("Vui lòng nhập tên bài hát hoặc đường link!"));

      const cleanedQuery = cleanQuery(query);
      const player = await getPlayer();
      if (!player.connection) await player.connect(voiceChannel);

      const success = await player.play(cleanedQuery, msg.author.id);
      if (!success) return reply(errEmbed("Không tìm thấy kết quả hoặc không thể tải luồng phát nhạc."));

      if (player.isPlaying && player.currentTrack?.requestedBy !== msg.author.id) {
        return reply(
          new EmbedBuilder()
            .setColor(0x6366f1)
            .setDescription(`📋 Đã thêm vào hàng đợi bài hát thành công!`)
        );
      }
      break;
    }

    case "pause": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Hiện không có bài hát nào đang phát!"));
      if (!checkPermission(player)) return reply(errEmbed("Bạn không có quyền tạm dừng bài hát này!"));

      player.pause();
      return reply(new EmbedBuilder().setColor(0xf59e0b).setDescription("⏸ Đã tạm dừng bài hát."));
    }

    case "resume":
    case "r": {
      const player = manager.get(msg.guildId);
      if (!player?.isPaused) return reply(errEmbed("Nhạc hiện không ở trạng thái tạm dừng!"));
      if (!checkPermission(player)) return reply(errEmbed("Bạn không có quyền phát tiếp bài hát này!"));

      player.resume();
      return reply(new EmbedBuilder().setColor(0x22c55e).setDescription("▶️ Đã tiếp tục phát nhạc."));
    }

    case "skip":
    case "s": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Không có bài hát nào đang phát!"));
      if (!checkPermission(player)) return reply(errEmbed("Bạn không có quyền bỏ qua bài hát này!"));

      player.skip();
      return reply(new EmbedBuilder().setColor(0x22c55e).setDescription("⏭ Đã bỏ qua bài hát hiện tại!"));
    }

    case "stop": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Không có nhạc đang phát!"));
      if (!checkPermission(player)) return reply(errEmbed("Bạn không có quyền dừng trình phát nhạc!"));

      player.stop();
      return reply(new EmbedBuilder().setColor(0xef4444).setDescription("⏹ Đã dừng bài hát và xóa hàng đợi."));
    }

    case "seek": {
      const player = manager.get(msg.guildId);
      if (!player?.currentTrack) return reply(errEmbed("Không có nhạc đang phát!"));
      if (!checkPermission(player)) return reply(errEmbed("Bạn không có quyền tua nhạc!"));
      const seconds = parseInt(query);
      if (isNaN(seconds)) return reply(errEmbed("Cú pháp: `!seek <số_giây>` (Ví dụ: `!seek 60` để tua đến phút 1)"));

      await player.seek(seconds * 1000);
      return reply(new EmbedBuilder().setColor(0x6366f1).setDescription(`⏩ Đã tua đến mốc **${seconds}s**`));
    }

    case "volume":
    case "vol": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("Trình phát nhạc chưa hoạt động."));
      const vol = parseInt(query);
      if (isNaN(vol) || vol < 0 || vol > 200) return reply(errEmbed("Âm lượng hỗ trợ từ 0 đến 200."));

      player.setVolume(vol);
      return reply(new EmbedBuilder().setColor(0x6366f1).setDescription(`🔊 Âm lượng đã chỉnh thành **${vol}%**`));
    }

    case "loop":
    case "l": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("Trình phát nhạc chưa hoạt động."));
      const modes = ["off", "track", "queue"];
      const mode = query.toLowerCase();
      if (!modes.includes(mode)) return reply(errEmbed("Các chế độ lặp hợp lệ: `off`, `track`, `queue`"));

      player.loop(mode);
      return reply(new EmbedBuilder().setColor(0x8b5cf6).setDescription(`🔁 Chế độ lặp: **${mode}**`));
    }

    case "shuffle": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("Trình phát nhạc chưa hoạt động."));

      player.shuffle();
      return reply(new EmbedBuilder().setColor(0x8b5cf6).setDescription("🔀 Đã xáo trộn danh sách phát!"));
    }

    case "queue":
    case "q": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("Trình phát nhạc chưa hoạt động."));

      const current = player.currentTrack;
      const upcoming = player.upcomingTracks.slice(0, 10);
      if (!current && upcoming.length === 0) return reply(errEmbed("Hàng đợi phát nhạc hiện đang trống!"));

      const embed = new EmbedBuilder().setColor(0x6366f1).setTitle("🎵 Danh Sách Phát Nhạc");
      if (current) {
        embed.addFields({
          name: "▶️ Đang phát",
          value: `**${current.title}** — ${formatDuration(current.duration)}`,
        });
      }
      if (upcoming.length > 0) {
        embed.addFields({
          name: "📋 Tiếp theo",
          value: upcoming.map((t, i) => `\`${i + 1}.\` ${t.title} — ${formatDuration(t.duration)}`).join("\n"),
        });
      }
      embed.setFooter({ text: "Tổng cộng: " + player.queueSize + " bài hát trong hàng đợi" });
      return reply(embed);
    }

    case "nowplaying":
    case "np": {
      const player = manager.get(msg.guildId);
      if (!player?.currentTrack) return reply(errEmbed("Hiện không có bài hát nào đang phát!"));

      const track = player.currentTrack;
      const bar = player.getProgressBar({
        size: 18,
        barChar: "▬",
        progressChar: "🔘",
        timeFormat: "compact",
        showPercentage: true,
      });
      const time = player.getTime();

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle("🎵 Thông Tin Bài Hát Hiện Tại")
        .setDescription(`**[${track.title}](${track.url})**`)
        .setThumbnail(track.thumbnail ?? null)
        .addFields(
          { name: "Tiến trình", value: `\`${bar}\``, inline: false },
          {
            name: "Thời gian",
            value: `${time.formatted.current} / ${track.isLive ? "🔴 Trực tiếp" : time.formatted.total}`,
            inline: true,
          },
          { name: "Âm lượng", value: `${player.volume}%`, inline: true }
        );

      return reply(embed);
    }

    case "help":
    case "h": {
      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle("📖 DANH SÁCH LỆNH BOT NHẠC")
        .addFields(
          {
            name: "▶️ Phát & Điều Khiển",
            value: "`!play <tên/link>` hoặc `!p` • Phát nhạc từ YT/Spotify\n`!pause` • Tạm dừng phát\n`!resume` hoặc `!r` • Phát tiếp\n`!skip` hoặc `!s` • Bỏ qua bài hiện tại\n`!stop` • Dừng phát nhạc\n`!seek <giây>` • Tua nhạc",
          },
          {
            name: "⚙️ Tùy Chỉnh & Hàng Đợi",
            value: "`!queue` hoặc `!q` • Xem danh sách chờ\n`!nowplaying` hoặc `!np` • Xem tiến trình bài hát\n`!volume <0-200>` • Chỉnh âm lượng\n`!loop <off/track/queue>` • Chế độ lặp\n`!shuffle` • Trộn bài hát",
          }
        );
      return reply(embed);
    }
  }
});

/* =========================================================
   7. ĐĂNG NHẬP CLIENT DISCORD
========================================================= */
client.login(process.env.DISCORD_TOKEN);
