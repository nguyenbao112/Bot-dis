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
   1. KHỞI TẠO WEB SERVER TRÁNH CRASH TRÊN RENDER
========================================================= */
const PORT = process.env.PORT || 10000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bot Discord Online 24/7!");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Web server running on port ${PORT}`);
  });

/* =========================================================
   2. HÀM XỬ LÝ COOKIE NETSCAPE
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
      const name = parts[5].trim();
      const value = parts[6].trim();
      cookies.push(`${name}=${value}`);
    }
  }
  return cookies.join("; ");
}

const RAW_COOKIE = process.env.YT_COOKIE || "";
const FORMATTED_COOKIE = parseNetscapeCookie(RAW_COOKIE);

/* =========================================================
   3. HELPER FUNCTIONS
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

function capitalize(str) {
  if (!str) return "Unknown";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function parseSeek(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) return parseInt(input, 10) * 1000;
  const parts = input.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return null;
}

function cleanQuery(input) {
  if (!input) return input;
  if (input.includes("youtube.com") || input.includes("youtu.be")) {
    try {
      const url = new URL(input);
      url.searchParams.delete("si");
      url.searchParams.delete("pp");
      return url.toString();
    } catch {
      return input.split("?si=")[0];
    }
  }
  return input;
}

/* =========================================================
   4. KHỞI TẠO DISCORD CLIENT & PLAYER MANAGER
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
      highWaterMark: 1 << 26,
      quality: "highestaudio",
      cookies: FORMATTED_COOKIE,
      // Tắt SABR để khắc phục hoàn toàn lỗi "No suitable formats found"
      sabrOptions: {
        enabled: false,
      },
      ytdlOptions: {
        filter: "audioonly",
        quality: "highestaudio",
        highWaterMark: 1 << 26,
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
   5. SỰ KIỆN MUSIC PLAYER
========================================================= */
manager.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (!channel) return;

  const requesterTag =
    (await client.users.fetch(track.requestedBy).catch(() => null))?.tag ??
    "Unknown";

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle("🎵 Now Playing")
    .setDescription(`**[${track.title}](${track.url})**`)
    .setThumbnail(track.thumbnail ?? null)
    .addFields(
      {
        name: "Duration",
        value: track.isLive ? "🔴 LIVE" : formatDuration(track.duration),
        inline: true,
      },
      { name: "Source", value: capitalize(track.source), inline: true },
      { name: "Requested by", value: requesterTag, inline: true }
    )
    .setFooter({ text: "ZiPlayer • Crystal Audio" });

  await channel.send({ embeds: [embed] });
});

manager.on("queueEnd", async (player) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setDescription("✅ Queue finished. Leaving voice channel."),
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
          .setTitle("❌ Playback Error")
          .setDescription(
            `Failed on **${track?.title ?? "Unknown"}**\n\`${error.message}\``
          ),
      ],
    });
  }
});

/* =========================================================
   6. SỰ KIỆN XỬ LÝ LỆNH (MESSAGE COMMANDS)
========================================================= */
client.on(Events.ClientReady, () => {
  console.log(`🤖 Bot online với tên: ${client.user.tag}`);
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
      },
      loudnessNormalization: { enabled: false },
    });
    p.textChannelId = msg.channelId;
    return p;
  }

  function isOwnerOrMod(player) {
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
      if (!voiceChannel) return reply(errEmbed("You need to be in a voice channel!"));
      if (!query) return reply(errEmbed("Provide a song name or URL."));

      const cleanedQuery = cleanQuery(query);
      const player = await getPlayer();
      if (!player.connection) await player.connect(voiceChannel);

      const success = await player.play(cleanedQuery, msg.author.id);
      if (!success) return reply(errEmbed("Could not find or play that track. Try searching by song name!"));

      if (player.isPlaying && player.currentTrack?.requestedBy !== msg.author.id) {
        return reply(
          new EmbedBuilder()
            .setColor(0x6366f1)
            .setDescription(`📋 Added to queue: **${query}**`)
        );
      }
      break;
    }

    case "pause": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Nothing is playing!"));

      if (!isOwnerOrMod(player)) {
        return reply(errEmbed("Chỉ người yêu cầu bài hát này mới có quyền tạm dừng!"));
      }

      player.pause();
      return reply(new EmbedBuilder().setColor(0xf59e0b).setDescription("⏸ Paused."));
    }

    case "resume":
    case "r": {
      const player = manager.get(msg.guildId);
      if (!player?.isPaused) return reply(errEmbed("Nothing is paused!"));

      if (!isOwnerOrMod(player)) {
        return reply(errEmbed("Chỉ người yêu cầu bài hát này mới có quyền tiếp tục!"));
      }

      player.resume();
      return reply(new EmbedBuilder().setColor(0x22c55e).setDescription("▶️ Resumed."));
    }

    case "skip":
    case "s": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Nothing is playing!"));

      if (!isOwnerOrMod(player)) {
        return reply(errEmbed("Chỉ người yêu cầu bài hát này mới có quyền Skip!"));
      }

      player.skip();
      return reply(
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setDescription("⏭ Skipped track!")
      );
    }

    case "stop": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Nothing is playing!"));

      if (!isOwnerOrMod(player)) {
        return reply(errEmbed("Chỉ người yêu cầu bài hát này mới có quyền Stop!"));
      }

      player.stop();
      return reply(
        new EmbedBuilder().setColor(0xef4444).setDescription("⏹ Stopped and queue cleared.")
      );
    }

    case "volume":
    case "vol": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("No player active."));
      const vol = parseInt(query);
      if (isNaN(vol) || vol < 0 || vol > 200)
        return reply(errEmbed("Volume must be 0–200."));
      player.setVolume(vol);
      return reply(
        new EmbedBuilder()
          .setColor(0x6366f1)
          .setDescription(`🔊 Volume set to **${vol}%**`)
      );
    }

    case "loop":
    case "l": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("No player active."));
      const modes = ["off", "track", "queue"];
      const mode = query.toLowerCase();
      if (!modes.includes(mode)) return reply(errEmbed("Modes: `off`, `track`, `queue`"));
      player.loop(mode);
      return reply(
        new EmbedBuilder().setColor(0x8b5cf6).setDescription(`🔁 Loop set to **${mode}**`)
      );
    }

    case "shuffle": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("No player active."));
      player.shuffle();
      return reply(
        new EmbedBuilder().setColor(0x8b5cf6).setDescription("🔀 Queue shuffled!")
      );
    }

    case "queue":
    case "q": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("No player active."));

      const current = player.currentTrack;
      const upcoming = player.upcomingTracks.slice(0, 10);

      if (!current && upcoming.length === 0) return reply(errEmbed("Queue is empty!"));

      const embed = new EmbedBuilder().setColor(0x6366f1).setTitle("🎵 Music Queue");

      if (current) {
        embed.addFields({
          name: "▶️ Now Playing",
          value: `**${current.title}** — ${formatDuration(current.duration)}`,
        });
      }

      if (upcoming.length > 0) {
        embed.addFields({
          name: "📋 Up Next",
          value: upcoming
            .map((t, i) => `\`${i + 1}.\` ${t.title} — ${formatDuration(t.duration)}`)
            .join("\n"),
        });
      }

      embed.setFooter({ text: `${player.queueSize} track(s) in queue` });
      return reply(embed);
    }

    case "nowplaying":
    case "np": {
      const player = manager.get(msg.guildId);
      if (!player?.currentTrack) return reply(errEmbed("Nothing is playing!"));

      const track = player.currentTrack;
      const bar = player.getProgressBar({
        size: 20,
        barChar: "▬",
        progressChar: "🔘",
        timeFormat: "compact",
        showPercentage: true,
      });
      const time = player.getTime();

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle("🎵 Now Playing")
        .setDescription(`**[${track.title}](${track.url})**`)
        .setThumbnail(track.thumbnail ?? null)
        .addFields(
          { name: "Progress", value: `\`${bar}\``, inline: false },
          {
            name: "Time",
            value: `${time.formatted.current} / ${track.isLive ? "🔴 LIVE" : time.formatted.total}`,
            inline: true,
          },
          { name: "Volume", value: `${player.volume}%`, inline: true },
          { name: "Loop", value: capitalize(player.queue?.loopMode ?? "off"), inline: true }
        );

      return reply(embed);
    }

    case "help":
    case "h": {
      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle("🎵 BẢNG HƯỚNG DẪN SỬ DỤNG")
        .setDescription("Chỉ người bật bài hát mới có quyền `!skip`, `!stop`, `!pause`, `!resume`.")
        .addFields(
          {
            name: "▶️ Điều Khiển",
            value: "`!play <tên/link>` • Phát nhạc\n`!pause` • Tạm dừng\n`!resume` • Tiếp tục\n`!skip` • Bỏ qua\n`!stop` • Dừng phát",
          },
          {
            name: "📋 Hàng Đợi",
            value: "`!queue` • Xem hàng đợi\n`!nowplaying` • Bài hát hiện tại\n`!volume <0-200>` • Âm lượng",
          }
        );

      return reply(embed);
    }
  }
});

/* =========================================================
   7. ĐĂNG NHẬP BOT
========================================================= */
client.login(process.env.DISCORD_TOKEN);
