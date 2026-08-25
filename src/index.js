import "ffmpeg-static"; // Thêm thư viện ffmpeg tĩnh để xử lý âm thanh trên Render
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
} from "discord.js";
import { PlayerManager } from "ziplayer";
import {
  YouTubePlugin,
  SpotifyPlugin,
  TTSPlugin,
} from "@ziplayer/plugin";
import { InfinityPlugin } from "@ziplayer/infinity";

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;
const YT_COOKIE = process.env.YT_COOKIE || "";

if (!TOKEN) {
  console.error("❌ Không tìm thấy DISCORD_TOKEN hoặc TOKEN trong môi trường.");
  process.exit(1);
}

// --- WEB SERVER KEEP-ALIVE ---
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.write("Bot ZiPlayer is Running!");
  res.end();
}).listen(process.env.PORT || 3000, () => {
  console.log("🌐 Keep-alive server đã sẵn sàng tại cổng 3000");
});

const formatTime = (ms) => {
  if (ms == null || isNaN(ms) || ms < 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

const parseTimeStringToSeconds = (str) => {
  if (!str || typeof str !== "string") return null;
  const parts = str.trim().split(":").map(p => parseInt(p, 10));
  if (parts.some(p => isNaN(p))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
};

const getTrackTimes = (player, track) => {
  let total = 0;
  let current = 0;

  const totalCandidates = [
    track?.durationMS,
    track?.durationMs,
    track?.duration,
    track?.lengthMs,
    track?.length,
    track?.info?.duration,
    track?.info?.length,
    track?.info?.durationMs,
    track?.info?.lengthMs,
    track?.info?.lengthSeconds,
    track?.meta?.duration,
    track?.meta?.durationSeconds,
    track?.durationSeconds,
    track?.lengthSeconds,
    track?.formattedDuration,
    track?.humanDuration,
    track?.displayDuration,
  ];

  for (const cand of totalCandidates) {
    if (cand != null) {
      if (!isNaN(cand)) {
        total = Number(cand);
        break;
      }
      if (typeof cand === "string") {
        const secs = parseTimeStringToSeconds(cand);
        if (secs != null) {
          total = secs;
          break;
        }
      }
    }
  }

  const currentCandidates = [
    player?.playbackDuration,
    player?.playbackDurationMs,
    player?.position,
    player?.currentTime,
    player?.streamTime,
    track?.position,
    track?.playedPosition,
  ];
  for (const cand of currentCandidates) {
    if (cand != null) {
      if (!isNaN(cand)) {
        current = Number(cand);
        break;
      }
      if (typeof cand === "string") {
        const secs = parseTimeStringToSeconds(cand);
        if (secs != null) {
          current = secs;
          break;
        }
      }
    }
  }

  if (typeof player?.getTime === "function") {
    try {
      const timeObj = player.getTime();
      if (timeObj) {
        if (timeObj.current != null && !isNaN(timeObj.current)) {
          current = Number(timeObj.current);
        }
        if (timeObj.total != null && !isNaN(timeObj.total)) {
          total = Number(timeObj.total);
        }
      }
    } catch (e) {}
  }

  if (typeof total === "string") {
    const secs = parseTimeStringToSeconds(total);
    if (secs != null) total = secs;
  }
  if (typeof current === "string") {
    const secs = parseTimeStringToSeconds(current);
    if (secs != null) current = secs;
  }

  const looksLikeSeconds = (v) => v > 0 && v < 100000;

  if (total > 0 && looksLikeSeconds(total) && !(track?.durationMS || track?.durationMs || track?.info?.durationMs)) {
    total = total * 1000;
  }

  if (current > 0 && looksLikeSeconds(current) && (current < total || total === 0)) {
    current = current * 1000;
  }

  if (total > 0 && current > 0 && current > total * 10) {
    if (current > 1000 && (current / 1000) <= total * 2) {
      current = Math.round(current / 1000);
    }
  }

  total = Math.max(0, Number(total) || 0);
  current = Math.max(0, Number(current) || 0);

  if (total > 0 && current > total) current = Math.min(current, total);

  return { currentMs: current, totalMs: total };
};

const createProgressBar = (currentMs, totalMs, size = 15) => {
  if (!totalMs || totalMs <= 0) {
    const bar = "▬".repeat(size);
    return `${formatTime(currentMs)} ${bar}🔘 Unknown`;
  }

  const current = Math.min(Math.max(0, currentMs), totalMs);
  const progress = Math.round((size * current) / totalMs);
  const empty = size - progress;

  const left = "▬".repeat(Math.max(0, progress));
  const right = "▬".repeat(Math.max(0, empty));

  return `${formatTime(current)} ${left}🔘${right} ${formatTime(totalMs)}`;
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- CẤU HÌNH YOUTUBE & THỨ TỰ PLUGIN ---
const ytOptions = {
  playerClients: ["TVHTML5", "ANDROID", "IOS"],
  fetchOptions: {
    headers: {
      "User-Agent": "Mozilla/5.0 (SmartTV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.93 TV Safari/537.36",
    },
  },
};

if (YT_COOKIE && YT_COOKIE.trim() !== "") {
  ytOptions.youtubeOptions = { cookies: YT_COOKIE };
}

const manager = new PlayerManager({
  plugins: [
    new TTSPlugin(),
    new SpotifyPlugin(),
    new InfinityPlugin(),
    new YouTubePlugin(ytOptions),
  ],
  autoCleanup: false,
  extractorTimeout: 120000,
});

client.once(Events.ClientReady, (readyClient) => {
  console.log("========================================");
  console.log("🤖 BOT MUSIC ĐÃ ONLINE SẴN SÀNG");
  console.log(`👤 ${readyClient.user.tag}`);
  console.log("🎵 Nguồn hỗ trợ: YouTube, Spotify, SoundCloud, Infinity");
  console.log("========================================");
});

client.on("error", (err) => console.error("Discord client error:", err));
process.on("unhandledRejection", (err) => console.error("UnhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("UncaughtException:", err));

// --- XỬ LÝ LỖI CLARITY FILTER ---
const applyClarity = async (player) => {
  if (!player) return false;
  try {
    if (player.filter && typeof player.filter.applyFilter === "function") {
      await player.filter.applyFilter("trebleboost");
      return true;
    }
    if (player.filters && typeof player.filters.set === "function") {
      await player.filters.set("trebleboost");
      return true;
    }
    if (typeof player.setFilter === "function") {
      await player.setFilter("trebleboost");
      return true;
    }
    if (player.filters && typeof player.filters.setTrebleBoost === "function") {
      await player.filters.setTrebleBoost(true);
      return true;
    }
    return false;
  } catch (error) {
    console.error("applyClarity error:", error);
    return false;
  }
};

// --- TRÍCH XUẤT TRACK HỢP LỆ ---
const extractTracksFromResult = (result) => {
  if (!result) return [];
  
  let rawList = [];
  if (Array.isArray(result)) rawList = result;
  else if (Array.isArray(result?.tracks)) rawList = result.tracks;
  else if (result?.track) rawList = [result.track];
  else if (result?.playlist && Array.isArray(result.playlist)) rawList = result.playlist;
  else if (typeof result === "object") rawList = [result];

  return rawList.filter(
    (t) => t && (t.title || t.name) && t.title !== "Unknown title" && (t.url || t.uri) && t.url !== "undefined"
  );
};

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.guildId || msg.author.bot || typeof msg.content !== "string" || !msg.content.startsWith("!")) return;

    const parts = msg.content.slice(1).trim().split(/\s+/);
    const command = parts.shift()?.toLowerCase();
    const query = parts.join(" ").trim();

    const musicCommands = [
      "help", "h", "play", "p", "scplay", "sc", "pause", "resume",
      "skip", "s", "stop", "volume", "vol", "filter", "clarity",
      "queue", "q", "nowplaying", "np", "join", "leave", "seek",
      "time", "t",
    ];
    if (!musicCommands.includes(command)) return;

    if (command === "help" || command === "h") {
      const helpEmbed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🎵 HƯỚNG DẪN SỬ DỤNG BOT NHẠC")
        .setDescription("Tiền tố lệnh: `!` • Nguồn: **YouTube • Spotify • SoundCloud • Infinity**")
        .addFields(
          {
            name: "▶️ Phát nhạc",
            value:
              "`!play <tên|URL>` (`!p`) — Phát từ YouTube/Spotify/Infinity\n" +
              "`!scplay <tên|URL>` (`!sc`) — Phát từ SoundCloud\n" +
              "Ví dụ: `!play Despacito`",
            inline: false
          },
          {
            name: "⏯️ Điều khiển & tua",
            value:
              "`!pause` — Tạm dừng\n`!resume` — Tiếp tục\n" +
              "`!seek <mm:ss>` hoặc `!seek <s>` — Tua đến thời gian (VD: `!seek 01:30` hoặc `!seek 90`)",
            inline: false
          },
          {
            name: "⏭️ Bỏ qua / Dừng (Quyền hạn)",
            value:
              "`!skip` (hoặc `!s`) — Bỏ qua bài hiện tại\n`!stop` — Dừng phát và xóa hàng đợi\n" +
              "**Chỉ người đã yêu cầu bài** (requester) mới được dùng `!skip` / `!stop`.",
            inline: false
          },
          {
            name: "🔊 Âm lượng & EQ",
            value:
              "`!volume <0-200>` — Điều chỉnh âm lượng\n`!clarity` — Bật Clarity EQ",
            inline: false
          },
          {
            name: "ℹ️ Thông tin & hàng đợi",
            value:
              "`!nowplaying` / `!np` — Xem bài đang phát\n`!time` / `!t` — Thời gian hiện tại/tổng\n`!queue` / `!q` — Xem 10 bài đầu hàng đợi",
            inline: false
          },
          {
            name: "📌 Tiện ích",
            value:
              "`!join` / `!leave` — Vào/rời voice 24/7\n`!time debug` — In dữ liệu thô để debug",
            inline: false
          }
        )
        .setFooter({ text: "Gõ !help để xem lại • Liên hệ admin nếu cần hỗ trợ" })
        .setTimestamp();

      return msg.reply({ embeds: [helpEmbed] });
    }

    const voiceChannel = msg.member?.voice?.channel;
    let player = manager.get(msg.guildId);

    const getOrCreatePlayer = async () => {
      if (!player) {
        player = await manager.create(msg.guildId, {
          volume: 100,
          autoSelfDeaf: true,
          leaveOnEmpty: false,
          leaveOnEnd: false,
          leaveOnStop: false,
        });
      }
      return player;
    };

    if (command === "join") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice trước.");
      const activePlayer = await getOrCreatePlayer();
      if (!activePlayer.connection) {
        try { await activePlayer.connect(voiceChannel); } catch (e) { console.error("connect error:", e); }
      }
      return msg.reply(`📌 Đã vào **${voiceChannel.name}** 24/7!`);
    }

    if (command === "leave") {
      if (!player) return msg.reply("❌ Bot chưa ở trong phòng voice.");
      try { if (typeof player.destroy === "function") await player.destroy(); } catch (e) { console.error("Error destroying player:", e); }
      return msg.reply("👋 Bot đã rời phòng voice.");
    }

    if (["play", "p", "scplay", "sc"].includes(command)) {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice trước.");
      if (!query) return msg.reply("❌ Dùng: `!play <tên bài/URL>`");

      const activePlayer = await getOrCreatePlayer();

      const ensureConnected = async (player, channel, attempts = 3) => {
        for (let i = 0; i < attempts; i++) {
          try {
            if (player.connection) return true;
            await player.connect(channel);
            await sleep(400);
            if (player.connection) return true;
          } catch (err) {
            console.error(`connect attempt ${i + 1} failed:`, err);
            await sleep(500);
          }
        }
        return !!player.connection;
      };

      const connected = await ensureConnected(activePlayer, voiceChannel, 3);
      if (!connected) {
        return msg.reply("❌ Không thể kết nối tới voice channel. Kiểm tra quyền hoặc thử lại.");
      }

      const replyMsg = await msg.reply("🔎 Đang tìm nhạc...");

      try {
        let searchQuery = query.trim();
        if ((command === "scplay" || command === "sc") && !searchQuery.startsWith("http")) {
          searchQuery = `scsearch:${searchQuery}`;
        }

        let result;
        try {
          const playPromise = activePlayer.play(searchQuery, msg.author.id);
          result = await Promise.race([
            playPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Play timeout")), 120000)
            )
          ]);
        } catch (timeoutErr) {
          console.error("Play timeout or error:", timeoutErr.message);
          return replyMsg.edit("❌ Không thể tải bài hát này (IP Render bị chặn). Hãy thử dán link Spotify!");
        }

        let foundTracks = extractTracksFromResult(result);

        if (foundTracks.length === 0 && activePlayer.currentTrack) {
          const valid = extractTracksFromResult(activePlayer.currentTrack);
          if (valid.length > 0) foundTracks = valid;
        }

        if (foundTracks.length === 0) {
          return replyMsg.edit("❌ Bài hát bị chặn stream trên IP này. Hãy dán trực tiếp **Link Spotify**!");
        }

        if (foundTracks.length > 1 && activePlayer.queue?.add) {
          for (let i = 1; i < foundTracks.length; i++) {
            try {
              if (foundTracks[i]) foundTracks[i].requestedBy = msg.author.id;
              activePlayer.queue.add(foundTracks[i]);
            } catch (e) {
              console.warn("Failed to add track to queue:", e);
            }
          }
        }

        if (!activePlayer.currentTrack && foundTracks.length > 0) {
          try {
            if (foundTracks[0]) foundTracks[0].requestedBy = msg.author.id;
            await activePlayer.play(foundTracks[0], msg.author.id);
            await sleep(500);
          } catch (e) {
            console.warn("Fallback play attempt failed:", e.message);
          }
        }

        if (activePlayer.currentTrack && activePlayer.currentTrack.title !== "Unknown title") {
          activePlayer.currentTrack.requestedBy = msg.author.id;
          const title = activePlayer.currentTrack.title || activePlayer.currentTrack.name || foundTracks[0]?.title || "Bài hát";
          return replyMsg.edit(`▶️ Đang phát: **${title}**`);
        } else {
          if (foundTracks.length > 1) {
            return replyMsg.edit(`🎶 Đã thêm **${foundTracks.length} bài** vào hàng đợi!`);
          }
          return replyMsg.edit("❌ Đã tìm thấy bài nhưng không thể lấy luồng phát. Vui lòng dùng link Spotify!");
        }
      } catch (error) {
        console.error("Play error details:", error);
        return replyMsg.edit("❌ Lỗi tải bài hát. Hãy thử lại bằng link Spotify!");
      }
    }

    if (!player) return msg.reply("❌ Bot chưa hoạt động trong Server này.");

    if (command === "pause") {
      if (typeof player.pause === "function") {
        try { player.pause(); } catch (e) { console.error("pause error:", e); return msg.reply("❌ Không thể pause."); }
        return msg.reply("⏸️ Đã tạm dừng.");
      } else return msg.reply("❌ Không hỗ trợ pause.");
    }
    if (command === "resume") {
      if (typeof player.resume === "function") {
        try { player.resume(); } catch (e) { console.error("resume error:", e); return msg.reply("❌ Không thể resume."); }
        return msg.reply("▶️ Đã phát tiếp.");
      } else return msg.reply("❌ Không hỗ trợ resume.");
    }

    if (command === "skip" || command === "s") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice.");
      const currentTrack = player.currentTrack;
      if (!currentTrack) return msg.reply("❌ Không có bài hát nào đang phát.");
      
      if (currentTrack.requestedBy && currentTrack.requestedBy !== msg.author.id) {
        return msg.reply("🔒 Chỉ người yêu cầu bài hát này mới có quyền skip!");
      }

      try {
        if (typeof player.skip === "function") player.skip();
        else if (player.queue?.advance) player.queue.advance();
        else return msg.reply("❌ Không thể skip.");
      } catch (e) { console.error("skip error:", e); return msg.reply("❌ Lỗi khi skip."); }
      return msg.reply(`⏭️ **${msg.author.displayName}** đã bỏ qua bài hát!`);
    }

    if (command === "stop") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice.");
      const currentTrack = player.currentTrack;

      if (currentTrack && currentTrack.requestedBy && currentTrack.requestedBy !== msg.author.id) {
        return msg.reply("🔒 Chỉ người yêu cầu bài hát hiện tại mới có quyền stop!");
      }

      try {
        if (typeof player.stop === "function") player.stop();
        else if (player.queue && typeof player.queue.clear === "function") player.queue.clear();
      } catch (e) { console.error("stop error:", e); return msg.reply("❌ Lỗi khi dừng."); }
      return msg.reply("⏹️ Đã dừng phát nhạc.");
    }

    if (command === "clarity") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice.");
      if (!player.currentTrack) return msg.reply("❌ Không có bài hát nào đang phát.");

      const success = await applyClarity(player);
      if (success) {
        return msg.reply("✨ Đã bật chế độ âm thanh **Clarity (Treble Boost)**!");
      } else {
        return msg.reply("❌ Trình phát nhạc hiện tại không hỗ trợ bộ lọc hiệu ứng Clarity.");
      }
    }

    if (command === "time" || command === "t") {
      if (query === "debug") {
        const timeObj = typeof player.getTime === "function" ? player.getTime() : null;
        return msg.reply("```json\n" + JSON.stringify({
          player: { getTime: timeObj },
          track: player.currentTrack || null
        }, null, 2) + "\n```");
      }

      const { currentMs, totalMs } = getTrackTimes(player, player.currentTrack);
      const bar = createProgressBar(currentMs, totalMs);
      return msg.reply(`🎵 **Tiến trình:**\n${bar}`);
    }

  } catch (err) {
    console.error("Message handling error:", err);
  }
});

client.login(TOKEN);
