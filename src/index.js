import "dotenv/config";
import http from "http";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  Events,
} from "discord.js";
import { PlayerManager } from "ziplayer";
import { YouTubePlugin, SpotifyPlugin } from "@ziplayer/plugin";
import { InfinityPlugin } from "@ziplayer/infinity";

/* =========================================================
   1. KHỞI TẠO WEB SERVER ĐỂ TRÁNH LỖI CRASH TRÊN RENDER
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
   2. HÀM BỔ TRỢ (HELPER FUNCTIONS)
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

/* =========================================================
   3. KHỞI TẠO DISCORD CLIENT & PLAYER MANAGER
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
    new YouTubePlugin({ highWaterMark: 1 << 25 }),
    new SpotifyPlugin(),
    new InfinityPlugin(),
  ],
  autoCleanup: true,
  extractorTimeout: 30000,
  enableSearchCache: true,
});

const voteState = new Map();

function countListeners(guild, player) {
  try {
    const botMember = guild.members.me;
    const vc = botMember?.voice?.channel;
    if (!vc) return 1;
    return vc.members.filter((m) => !m.user.bot).size;
  } catch {
    return 1;
  }
}

function votesRequired(listenerCount) {
  return Math.max(1, Math.ceil(listenerCount * 0.5));
}

function buildVoteEmbed(type, current, required, track) {
  const action = type === "skip" ? "⏭ Skip" : "⏹ Stop";
  const color = type === "skip" ? 0xf59e0b : 0xef4444;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${action} Vote`)
    .setDescription(
      `**${current}/${required}** votes needed to ${type}.\n` +
        `Track: **${track?.title ?? "Unknown"}**`
    )
    .setFooter({ text: "Vote expires in 60 seconds" });
}

function buildVoteRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote_yes_${guildId}`)
      .setLabel("✅ Vote Yes")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`vote_cancel_${guildId}`)
      .setLabel("❌ Cancel Vote")
      .setStyle(ButtonStyle.Danger)
  );
}

async function cleanupVote(guildId, channel, msgId) {
  voteState.delete(guildId);
  try {
    const msg = await channel.messages.fetch(msgId);
    await msg.delete().catch(() => {});
  } catch {}
}

async function startVote(type, guild, channel, player, requesterId) {
  if (voteState.has(guild.id)) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6b7280)
          .setDescription("⚠️ A vote is already in progress!"),
      ],
    });
    return;
  }

  const track = player.currentTrack;
  if (!track) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6b7280)
          .setDescription("❌ Nothing is playing right now."),
      ],
    });
    return;
  }

  const listeners = countListeners(guild, player);
  const required = votesRequired(listeners);
  const voters = new Set([requesterId]);

  if (voters.size >= required) {
    if (type === "skip") player.skip();
    else player.stop();
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setDescription(
            type === "skip"
              ? "⏭ Skipped! (only listener)"
              : "⏹ Stopped! (only listener)"
          ),
      ],
    });
    return;
  }

  const embed = buildVoteEmbed(type, voters.size, required, track);
  const row = buildVoteRow(guild.id);
  const msg = await channel.send({ embeds: [embed], components: [row] });

  voteState.set(guild.id, {
    type,
    voters,
    required,
    msgId: msg.id,
    channelId: channel.id,
    requesterId,
    trackId: track.id,
    timeout: setTimeout(async () => {
      await cleanupVote(guild.id, channel, msg.id);
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x6b7280)
            .setDescription("⌛ Vote expired — not enough votes."),
        ],
      });
    }, 60_000),
  });
}

/* =========================================================
   4. SỰ KIỆN MUSIC PLAYER
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
   5. SỰ KIỆN NÚT BẤM (BUTTON INTERACTION)
========================================================= */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, guild, user, channel } = interaction;
  const guildId = guild?.id;
  if (!guildId) return;

  const player = manager.get(guildId);
  const state = voteState.get(guildId);

  if (customId === `vote_yes_${guildId}`) {
    if (!state) {
      return interaction.reply({ content: "No active vote.", ephemeral: true });
    }

    if (state.voters.has(user.id)) {
      return interaction.reply({ content: "You already voted!", ephemeral: true });
    }

    const member = await guild.members.fetch(user.id);
    const botVc = guild.members.me?.voice?.channel;
    if (!botVc || member.voice.channelId !== botVc.id) {
      return interaction.reply({
        content: "You must be in the voice channel to vote!",
        ephemeral: true,
      });
    }

    state.voters.add(user.id);

    const listeners = countListeners(guild, player);
    const required = votesRequired(listeners);
    state.required = required;

    if (state.voters.size >= required) {
      clearTimeout(state.timeout);
      const type = state.type;
      await cleanupVote(guildId, channel, state.msgId);

      if (player) {
        if (type === "skip") player.skip();
        else player.stop();
      }

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setDescription(
              type === "skip"
                ? "⏭ Vote passed! Skipping..."
                : "⏹ Vote passed! Stopping..."
            ),
        ],
      });
    }

    const updatedEmbed = buildVoteEmbed(
      state.type,
      state.voters.size,
      required,
      player?.currentTrack
    );
    try {
      const msg = await channel.messages.fetch(state.msgId);
      await msg.edit({ embeds: [updatedEmbed], components: [buildVoteRow(guildId)] });
    } catch {}

    return interaction.reply({
      content: `✅ Vote counted! (${state.voters.size}/${required})`,
      ephemeral: true,
    });
  }

  if (customId === `vote_cancel_${guildId}`) {
    if (!state) {
      return interaction.reply({ content: "No active vote.", ephemeral: true });
    }

    const member = await guild.members.fetch(user.id);
    const canCancel =
      user.id === state.requesterId ||
      member.permissions.has(PermissionFlagsBits.ManageChannels);

    if (!canCancel) {
      return interaction.reply({
        content: "Only the vote starter or a moderator can cancel.",
        ephemeral: true,
      });
    }

    clearTimeout(state.timeout);
    await cleanupVote(guildId, channel, state.msgId);

    return interaction.reply({
      embeds: [
        new EmbedBuilder().setColor(0x6b7280).setDescription("🗑 Vote cancelled."),
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
  const guild = msg.guild;
  const member = msg.member;
  const voiceChannel = member?.voice?.channel;

  async function getPlayer() {
    const p = await manager.create(msg.guildId, {
      lowPerformance: false,
      preload: { enabled: true, autoDisableInLowPerformance: true },
      crossfade: {
        autoEnable: true,
        autoDisableInLowPerformance: true,
        durationMs: 4000,
      },
      smartTransition: {
        enabled: true,
        genreAware: true,
        beatAlign: true,
        baseDurationMs: 4500,
      },
      antiStuck: {
        enabled: true,
        maxRetries: 3,
        retryDelayMs: 800,
        reusePreloadFirst: true,
        reduceQualityOnRetry: true,
        controlledSkipThreshold: 3,
      },
      loudnessNormalization: {
        enabled: true,
        targetLUFS: -14,
        maxBoostDb: 6,
        maxCutDb: -6,
        limiterCeiling: 0.95,
      },
    });
    p.textChannelId = msg.channelId;
    return p;
  }

  const reply = (embed) => msg.reply({ embeds: [embed] });

  switch (command) {
    case "play":
    case "p": {
      if (!voiceChannel) return reply(errEmbed("You need to be in a voice channel!"));
      if (!query) return reply(errEmbed("Provide a song name or URL."));

      const player = await getPlayer();
      if (!player.connection) await player.connect(voiceChannel);

      const success = await player.play(query, msg.author.id);
      if (!success) return reply(errEmbed("Could not find or play that track."));

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
      player.pause();
      return reply(new EmbedBuilder().setColor(0xf59e0b).setDescription("⏸ Paused."));
    }

    case "resume":
    case "r": {
      const player = manager.get(msg.guildId);
      if (!player?.isPaused) return reply(errEmbed("Nothing is paused!"));
      player.resume();
      return reply(new EmbedBuilder().setColor(0x22c55e).setDescription("▶️ Resumed."));
    }

    case "skip":
    case "s": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Nothing is playing!"));

      const track = player.currentTrack;
      const isRequester = track?.requestedBy === msg.author.id;

      if (isRequester) {
        player.skip();
        return reply(
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setDescription("⏭ Skipped! (you requested this track)")
        );
      }

      await startVote("skip", guild, msg.channel, player, msg.author.id);
      break;
    }

    case "stop": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Nothing is playing!"));

      const track = player.currentTrack;
      const isRequester = track?.requestedBy === msg.author.id;
      const isMod = member.permissions.has(PermissionFlagsBits.ManageChannels);

      if (isRequester || isMod) {
        player.stop();
        voteState.delete(msg.guildId);
        return reply(
          new EmbedBuilder().setColor(0xef4444).setDescription("⏹ Stopped and queue cleared.")
        );
      }

      await startVote("stop", guild, msg.channel, player, msg.author.id);
      break;
    }

    case "voteskip":
    case "vs": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Nothing is playing!"));
      await startVote("skip", guild, msg.channel, player, msg.author.id);
      break;
    }

    case "votestop":
    case "vst": {
      const player = manager.get(msg.guildId);
      if (!player?.isPlaying) return reply(errEmbed("Nothing is playing!"));
      await startVote("stop", guild, msg.channel, player, msg.author.id);
      break;
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

    case "prev":
    case "previous": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("No player active."));
      await player.previous();
      return reply(
        new EmbedBuilder().setColor(0x6366f1).setDescription("⏮ Playing previous track.")
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

    case "remove":
    case "rm": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("No player active."));
      const idx = parseInt(query) - 1;
      if (isNaN(idx) || idx < 0) return reply(errEmbed("Provide a valid track number."));
      player.queue.remove(idx);
      return reply(
        new EmbedBuilder()
          .setColor(0xf59e0b)
          .setDescription(`🗑 Removed track #${idx + 1} from queue.`)
      );
    }

    case "seek": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("No player active."));
      const ms = parseSeek(query);
      if (ms === null) return reply(errEmbed("Format: `!seek 1:30` or `!seek 90`"));
      await player.seek(ms);
      return reply(
        new EmbedBuilder().setColor(0x6366f1).setDescription(`⏩ Seeked to **${query}**`)
      );
    }

    case "filter":
    case "fx": {
      const player = manager.get(msg.guildId);
      if (!player) return reply(errEmbed("No player active."));
      const validFilters = [
        "bassboost", "trebleboost", "nightcore", "lofi", "vaporwave",
        "echo", "reverb", "chorus", "karaoke", "normalize", "compressor", "limiter",
      ];
      if (query === "clear" || query === "reset") {
        await player.filter.clearAll();
        return reply(
          new EmbedBuilder().setColor(0x22c55e).setDescription("✅ All filters cleared.")
        );
      }
      if (!validFilters.includes(query))
        return reply(errEmbed(`Valid filters: \`${validFilters.join(", ")}\`, or \`clear\``));
      await player.filter.applyFilter(query);
      return reply(
        new EmbedBuilder().setColor(0x8b5cf6).setDescription(`✨ Filter **${query}** applied.`)
      );
    }

    case "help":
    case "h": {
      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle("🎵 BẢNG HƯỚNG DẪN SỬ DỤNG BOT NHẠC")
        .setDescription(
          "Chào mừng bạn đến với **Crystal Audio Bot**! Dưới đây là danh sách toàn bộ lệnh khả dụng. Tiền tố lệnh mặc định là `!`\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        )
        .setThumbnail(client.user?.displayAvatarURL() || null)
        .addFields(
          {
            name: "▶️  Phát & Tạm Dừng Nhạc",
            value:
              "`!play <tên/link>` (`!p`) • Phát nhạc hoặc thêm vào hàng đợi\n" +
              "`!pause` • Tạm dừng bài hát đang phát\n" +
              "`!resume` (`!r`) • Tiếp tục phát bài hát",
            inline: false,
          },
          {
            name: "⏭️  Bỏ Qua & Dừng (Có Tính Năng Vote)",
            value:
              "`!skip` (`!s`) • Bỏ qua bài hát (Requestor skip ngay, người khác cần vote)\n" +
              "`!stop` • Dừng nhạc & xóa hàng đợi (Mod/Requestor dừng ngay)\n" +
              "`!voteskip` (`!vs`) • Mở cuộc biểu quyết skip bài hát\n" +
              "`!votestop` (`!vst`) • Mở cuộc biểu quyết dừng nhạc",
            inline: false,
          },
          {
            name: "🎛️  Tùy Chỉnh & Bộ Lọc Âm Thanh",
            value:
              "`!volume <0-200>` (`!vol`) • Điều chỉnh âm lượng bot\n" +
              "`!filter <tên|clear>` (`!fx`) • Bật bộ lọc EQ (`bassboost`, `nightcore`, `lofi`...)\n" +
              "`!seek <thời gian>` • Nhảy đến thời gian chỉ định (`!seek 1:30` hoặc `!seek 90`)",
            inline: false,
          },
          {
            name: "📋  Quản Lý Hàng Đợi (Queue)",
            value:
              "`!queue` (`!q`) • Xem danh sách hàng đợi hiện tại\n" +
              "`!nowplaying` (`!np`) • Xem chi tiết bài hát đang phát + thanh tiến trình\n" +
              "`!loop <off|track|queue>` (`!l`) • Lặp lại bài hát hoặc toàn bộ hàng đợi\n" +
              "`!shuffle` • Trộn bài ngẫu nhiên trong hàng đợi\n" +
              "`!previous` (`!prev`) • Phát lại bài hát trước đó\n" +
              "`!remove <STT>` (`!rm`) • Xóa 1 bài khỏi hàng đợi theo số thứ tự",
            inline: false,
          }
        )
        .setFooter({
          text: "💡 Mẹo: Ngưỡng biểu quyết (Vote) mặc định là 50% số người nghe trong Voice Channel.",
          iconURL: msg.author.displayAvatarURL(),
        })
        .setTimestamp();

      return reply(embed);
    }
  }
});

/* =========================================================
   7. ĐĂNG NHẬP BOT
========================================================= */
client.login(process.env.DISCORD_TOKEN);
