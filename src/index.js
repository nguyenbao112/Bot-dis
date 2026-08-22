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

const manager = new PlayerManager({
  plugins: [
    new YouTubePlugin({
      youtubeOptions: { cookies: YT_COOKIE },
      playerClients: ["WEB_CREATOR", "IOS"],
    }),
    new SpotifyPlugin(),
    new TTSPlugin(),
    new InfinityPlugin(),
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

const applyClarity = async (player) => {
  if (!player) return false;
  try {
    if (player.filter && typeof player.filter.applyFilter === "function") {
      await player.filter.applyFilter("trebleboost");
      return true;
    }
    return false;
  } catch (error) {
    console.error("applyClarity error:", error);
    return false;
  }
};

const attemptSeek = async (player, desiredMs) => {
  const attempts = [];
  const pushAttempt = (fn) => attempts.push(fn);

  if (typeof player?.seek === "function") pushAttempt(async (arg) => player.seek(arg));
  if (player?.player && typeof player.player?.seek === "function") pushAttempt(async (arg) => player.player.seek(arg));
  if (player?.shuttle && typeof player.shuttle === "function") pushAttempt(async (arg) => player.shuttle(arg));

  const fallbackSetPosition = async (ms) => {
    if ("playbackDuration" in player) player.playbackDuration = ms;
    else if ("position" in player) player.position = ms;
    else throw new Error("no-position-field");
  };

  for (const fn of attempts) {
    try {
      await fn(desiredMs);
      await sleep(300);
      const { currentMs } = getTrackTimes(player, player.currentTrack || {});
      if (Math.abs(currentMs - desiredMs) <= 1500) return { ok: true, currentMs };
    } catch (e) {}
    try {
      const sec = Math.round(desiredMs / 1000);
      await fn(sec);
      await sleep(300);
      const { currentMs } = getTrackTimes(player, player.currentTrack || {});
      if (Math.abs(currentMs - desiredMs) <= 1500) return { ok: true, currentMs };
    } catch (e) {}
  }

  try {
    await fallbackSetPosition(desiredMs);
    await sleep(200);
    const { currentMs } = getTrackTimes(player, player.currentTrack || {});
    if (Math.abs(currentMs - desiredMs) <= 1500) return { ok: true, currentMs };
  } catch (e) {}

  try {
    if (typeof player?.seek === "function") {
      const sec = Math.round(desiredMs / 1000);
      await player.seek(sec);
      await sleep(300);
      const { currentMs } = getTrackTimes(player, player.currentTrack || {});
      if (Math.abs(currentMs - desiredMs) <= 1500) return { ok: true, currentMs };
    }
  } catch (e) {}

  return { ok: false, currentMs: null };
};

const fetchYouTubeDurationMs = async (url) => {
  try {
    const ytdl = await import("ytdl-core");
    const info = await ytdl.getInfo(url);
    const secs = info?.videoDetails?.lengthSeconds;
    if (secs && !isNaN(secs)) {
      return Number(secs) * 1000;
    }
  } catch (e) {
    console.error("Failed to fetch YouTube duration:", e.message || e);
  }
  return null;
};

// FIX: Hàm để trích xuất track từ kết quả search
const extractTracksFromResult = (result) => {
  if (!result) return [];
  
  // Nếu result là array trực tiếp
  if (Array.isArray(result)) return result;
  
  // Nếu có tracks array
  if (Array.isArray(result?.tracks)) return result.tracks;
  
  // Nếu có single track
  if (result?.track) return [result.track];
  
  // Nếu result là track object
  if (result?.title || result?.id || result?.uri || result?.url) return [result];
  
  // Nếu có playlist
  if (result?.playlist && Array.isArray(result.playlist)) return result.playlist;
  
  return [];
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
          },
          {
            name: "❗ Lưu ý",
            value:
              "1) Một số nguồn (stream hoặc file thiếu metadata) không có tổng thời lượng → sẽ hiển thị `Unknown`.\n" +
              "2) Để auto lấy tổng YouTube, cài `ytdl-core` (npm i ytdl-core).",
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

        // FIX: Thêm timeout và error handling tốt hơn
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
          return replyMsg.edit("❌ Không thể tải bài hát này (timeout hoặc lỗi plugin).");
        }

        console.log("play result:", result);

        // FIX: Sử dụng hàm trích xuất track cải thiện
        let foundTracks = extractTracksFromResult(result);

        // Fallback: nếu không tìm được track từ result, kiểm tra currentTrack
        if (foundTracks.length === 0 && activePlayer.currentTrack) {
          foundTracks = [activePlayer.currentTrack];
        }

        // FIX: Thêm log chi tiết để debug
        if (foundTracks.length === 0) {
          console.warn("No tracks found. Result structure:", {
            isArray: Array.isArray(result),
            keys: result ? Object.keys(result) : null,
            type: typeof result,
          });
          return replyMsg.edit("❌ Không tìm thấy bài hát. Thử URL khác hoặc từ khóa khác!");
        }

        // Thêm các track từ thứ 2 trở đi vào queue
        if (foundTracks.length > 1 && activePlayer.queue?.add) {
          for (let i = 1; i < foundTracks.length; i++) {
            try {
              activePlayer.queue.add(foundTracks[i]);
            } catch (e) {
              console.warn("Failed to add track to queue (non-fatal):", e);
            }
          }
        }

        // FIX: Đảm bảo track đầu tiên được phát
        if (!activePlayer.currentTrack && foundTracks.length > 0) {
          try {
            const firstTrack = foundTracks[0];
            console.log("Playing first track:", firstTrack?.title || firstTrack?.name);
            await activePlayer.play(firstTrack, msg.author.id);
            await sleep(500);
          } catch (e) {
            console.warn("Fallback play attempt failed:", e.message);
          }
        }

        // Phản hồi cuối cùng
        if (activePlayer.currentTrack) {
          const title = activePlayer.currentTrack.title || activePlayer.currentTrack.name || foundTracks[0]?.title || "Unknown";
          return replyMsg.edit(`▶️ Đang phát: **${title}**`);
        } else {
          if (foundTracks.length > 1) {
            return replyMsg.edit(`🎶 Đã thêm **${foundTracks.length} bài** vào hàng đợi!`);
          }
          return replyMsg.edit("❌ Đã tìm thấy bài nhưng không thể phát (kiểm tra logs).");
        }
      } catch (error) {
        console.error("Play error details:", error);
        return replyMsg.edit("❌ Không thể tải/phát bài hát này. Thử lại hoặc liên hệ admin.");
      }
    }

    if (!player) return msg.reply("❌ Bot chưa hoạt động trong Server này.");

    if (command === "pause") {
      if (typeof player.pause === "function") {
        try { player.pause(); } catch (e) { console.error("pause error:", e); return msg.reply("❌ Không thể pause nguồn này."); }
        return msg.reply("⏸️ Đã tạm dừng.");
      } else return msg.reply("❌ Lệnh pause không hỗ trợ bởi nguồn này.");
    }
    if (command === "resume") {
      if (typeof player.resume === "function") {
        try { player.resume(); } catch (e) { console.error("resume error:", e); return msg.reply("❌ Không thể resume nguồn này."); }
        return msg.reply("▶️ Đã phát tiếp.");
      } else return msg.reply("❌ Lệnh resume không hỗ trợ bởi nguồn này.");
    }

    if (command === "skip" || command === "s") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice.");
      const currentTrack = player.currentTrack;
      if (!currentTrack) return msg.reply("❌ Không có bài hát nào đang phát.");
      if (currentTrack.requestedBy && currentTrack.requestedBy !== msg.author.id) return msg.reply("🔒 Chỉ người yêu cầu bài hát này mới có quyền skip!");
      try {
        if (typeof player.skip === "function") player.skip();
        else if (player.queue?.advance) player.queue.advance();
        else return msg.reply("❌ Không thể skip nguồn này.");
      } catch (e) { console.error("skip error:", e); return msg.reply("❌ Lỗi khi skip bài hát."); }
      return msg.reply(`⏭️ **${msg.author.displayName}** đã bỏ qua bài hát!`);
    }

    if (command === "stop") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice.");
      const currentTrack = player.currentTrack;
      if (currentTrack && currentTrack.requestedBy && currentTrack.requestedBy !== msg.author.id) return msg.reply("🔒 Chỉ người yêu cầu bài hát hiện tại mới có quyền stop!");
      try {
        if (typeof player.stop === "function") player.stop();
        else if (player.queue && typeof player.queue.clear === "function") player.queue.clear();
        else return msg.reply("❌ Không thể stop nguồn này.");
      } catch (e) { console.error("stop error:", e); return msg.reply("❌ Lỗi khi dừng phát."); }
      return msg.reply("⏹️ Đã dừng phát nhạc.");
    }

    if (command === "seek") {
      if (!voiceChannel) return msg.reply("❌ Bạn phải vào phòng voice.");
      const track = player.currentTrack;
      if (!track) return msg.reply("❌ Không có bài hát nào đang phát.");
      if (!query) return msg.reply("❌ Nhập thời gian (VD: `!seek 01:30` hoặc `!seek 90`).");

      let timeInSeconds = 0;
      if (query.includes(":")) {
        const parts = query.split(":").map(p => parseInt(p, 10));
        if (parts.length === 3) timeInSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) timeInSeconds = parts[0] * 60 + parts[1];
      } else {
        timeInSeconds = parseInt(query, 10);
      }

      if (isNaN(timeInSeconds) || timeInSeconds < 0) return msg.reply("❌ Thời gian không hợp lệ.");

      const replyMsg = await msg.reply("⏩ Đang tua bài hát...");
      try {
        const timeInMs = timeInSeconds * 1000;
        const { totalMs } = getTrackTimes(player, track);
        if (totalMs > 0 && timeInMs > totalMs) return replyMsg.edit("❌ Thời gian nhập vượt quá tổng thời lượng bài hát.");

        const res = await attemptSeek(player, timeInMs);
        if (res.ok) return replyMsg.edit(`⏩ Đã tua đến **${formatTime(res.currentMs)}**`);
        else return replyMsg.edit("❌ Không thể tua bài này — nguồn có thể không hỗ trợ seek.");
      } catch (err) {
        console.error("Seek error:", err);
        return replyMsg.edit("❌ Nguồn phát này tạm thời không cho phép tua.");
      }
    }

    if (command === "time" || command === "t") {
      const track = player.currentTrack;
      if (!track) return msg.reply("❌ Không có bài nào đang phát.");

      if (query.toLowerCase() === "debug") {
        const debugObj = {
          player: {
            playbackDuration: player?.playbackDuration,
            position: player?.position,
            currentTime: player?.currentTime,
            streamTime: player?.streamTime,
            getTime: (typeof player?.getTime === "function") ? (() => {
              try { return player.getTime(); } catch { return "<getTime error>"; }
            })() : "<no getTime>",
          },
          track: {
            title: track?.title,
            url: track?.url || track?.uri,
            durationMS: track?.durationMS,
            durationMs: track?.durationMs,
            duration: track?.duration,
            length: track?.length,
            position: track?.position,
            info: track?.info,
            others: {
              formattedDuration: track?.formattedDuration,
              humanDuration: track?.humanDuration,
              displayDuration: track?.displayDuration,
              uri: track?.uri,
            }
          }
        };
        const txt = JSON.stringify(debugObj, null, 2).slice(0, 1800);
        return msg.reply({ content: `\`\`\`json\n${txt}\n\`\`\`` });
      }

      let { currentMs, totalMs } = getTrackTimes(player, track);
      const url = track.url || track.uri || "";

      if ((!totalMs || totalMs <= 0) && url && url.includes("youtube")) {
        if (!track._fetchedTotalMs) {
          const fetched = await fetchYouTubeDurationMs(url);
          if (fetched && fetched > 0) {
            totalMs = fetched;
            track._fetchedTotalMs = fetched;
          }
        } else {
          totalMs = track._fetchedTotalMs;
        }
      }

      const progressBar = createProgressBar(currentMs, totalMs);
      const title = track.title || track.name || "Unknown Track";

      const timeEmbed = new EmbedBuilder()
        .setColor("#ffaa00")
        .setTitle("⏱️ Thời gian bản nhạc")
        .setDescription(`**${title}**\n\n\`${progressBar}\``)
        .addFields(
          { name: "Hiện tại", value: formatTime(currentMs), inline: true },
          { name: "Tổng", value: totalMs > 0 ? formatTime(totalMs) : "Unknown", inline: true }
        );

      if (totalMs <= 0) {
        timeEmbed.addFields({ name: "Lưu ý", value: "Tổng thời lượng không xác định cho nguồn này.", inline: false });
      }

      return msg.reply({ embeds: [timeEmbed] });
    }

    if (command === "nowplaying" || command === "np") {
      const track = player.currentTrack;
      if (!track) return msg.reply("❌ Không có bài nào đang phát.");
      let { currentMs, totalMs } = getTrackTimes(player, track);
      const url = track.url || track.uri || "";
      if ((!totalMs || totalMs <= 0) && url && url.includes("youtube")) {
        if (!track._fetchedTotalMs) {
          const fetched = await fetchYouTubeDurationMs(url);
          if (fetched && fetched > 0) {
            totalMs = fetched;
            track._fetchedTotalMs = fetched;
          }
        } else {
          totalMs = track._fetchedTotalMs;
        }
      }
      const progressBar = createProgressBar(currentMs, totalMs);
      const title = track.title || track.name || "Unknown Track";
      const urlStr = track.url || track.uri || "";

      const npEmbed = new EmbedBuilder()
        .setColor("#00ff88")
        .setTitle("🎵 Đang Phát")
        .setDescription(`**[${title}](${urlStr || "#"})**\n\n\`${progressBar}\``);

      if (track.thumbnail || track.displayThumbnail) npEmbed.setThumbnail(track.thumbnail || track.displayThumbnail);

      if (track.requestedBy) {
        try {
          const member = await msg.guild?.members.fetch(track.requestedBy).catch(() => null);
          if (member) npEmbed.addFields({ name: "Yêu cầu bởi", value: member.displayName, inline: true });
        } catch (e) {}
      }

      return msg.reply({ embeds: [npEmbed] });
    }

    if (command === "volume" || command === "vol") {
      const vol = parseInt(query, 10);
      if (isNaN(vol) || vol < 0 || vol > 200) return msg.reply("❌ Volume từ 0 đến 200.");
      try {
        if (typeof player.setVolume === "function") player.setVolume(vol);
        else if ("volume" in player) player.volume = vol;
        else return msg.reply("❌ Không thể thay đổi volume cho nguồn này.");
      } catch (e) {
        console.error("Volume change error:", e);
        return msg.reply("❌ Không thể thay đổi volume cho nguồn này.");
      }
      return msg.reply(`🔊 Volume: **${vol}%**`);
    }

    if (command === "clarity" || command === "filter") {
      const ok = await applyClarity(player);
      return msg.reply(ok ? "✨ Đã bật **Clarity EQ**!" : "⚠️ Không thể bật Clarity trên nguồn này.");
    }

    if (command === "queue" || command === "q") {
      const tracks = Array.isArray(player.upcomingTracks) ? player.upcomingTracks.slice(0, 10) : (player.queue?.items?.slice(0, 10) || []);
      const queueList = tracks.length ? tracks.map((t, i) => `**${i + 1}.** ${t.title || t.name || "Unknown"}`).join("\n") : "Hàng đợi trống.";
      return msg.reply({ embeds: [new EmbedBuilder().setTitle("🎶 Hàng đợi").setDescription(queueList)] });
    }

  } catch (error) {
    console.error("🔥 ERROR in message handler:", error);
  }
});

client.login(TOKEN).catch((e) => {
  console.error("Failed to login:", e);
  process.exit(1);
});

const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot Online 24/7!");
}).listen(port, () => {
  console.log(`Health server listening on port ${port}`);
});
