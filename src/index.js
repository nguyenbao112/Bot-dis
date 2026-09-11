require("dotenv").config();
const express = require("express");
const { PlayerManager } = require("ziplayer");
const { Client, GatewayIntentBits } = require("discord.js");
// Note: do NOT import SoundCloudPlugin statically to avoid @zibot/scdl init when no key is present
const { YouTubePlugin, SpotifyPlugin } = require("@ziplayer/plugin");

// 1. Web Server Keep-Alive giúp Render luôn online
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
	res.send("Bot đang chạy 24/7!");
});

app.listen(PORT, () => {
	console.log(`Web server đang chạy ở cổng ${PORT}`);
});

// 2. Cấu hình Discord Bot & ZiPlayer
const prefix = "!";
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.MessageContent,
	],
});

// === CHỈ SỬA ĐOẠN NÀY ===
// SoundCloudKeyManager: probe SoundCloud for client_id and auto-refresh periodically.
// It will not force-recreate the player manager automatically (to avoid disrupting playback),
// but it will keep the in-memory client id up-to-date and log when a new id is found.
class SoundCloudKeyManager {
	constructor({ refreshIntervalMs = 6 * 60 * 60 * 1000, userAgent = null } = {}) {
		this.clientId = null;
		this.refreshIntervalMs = refreshIntervalMs;
		this.timer = null;
		this.userAgent = userAgent ||
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
		this.fetchOptions = {
			headers: {
				"User-Agent": this.userAgent,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				Referer: "https://soundcloud.com/",
			},
		};
		this.running = false;
	}

	async _fetchText(url) {
		if (typeof globalThis.fetch !== "function") {
			// fetch not available in this runtime
			throw new Error("fetch is not available in this Node runtime");
		}
		const resp = await fetch(url, this.fetchOptions);
		if (!resp.ok) throw new Error(`Fetch failed ${url} status ${resp.status}`);
		return await resp.text();
	}

	async probeForClientId() {
		// Try homepage first
		const homepage = await this._fetchText("https://soundcloud.com/");

		// Common patterns
		const reClient = /client_id["']?\s*[:=]\s*["']([a-zA-Z0-9_\-]{20,})["']/g;
		let m;
		while ((m = reClient.exec(homepage)) !== null) {
			if (m[1]) return m[1];
		}

		// Find scripts to probe
		const scriptRe = /<script[^>]+src=["']([^"']+)["']/g;
		const scriptUrls = [];
		let s;
		while ((s = scriptRe.exec(homepage)) !== null) {
			let src = s[1];
			if (src.startsWith("//")) src = "https:" + src;
			else if (src.startsWith("/")) src = "https://soundcloud.com" + src;
			if (src.startsWith("http")) scriptUrls.push(src);
		}

		for (const u of scriptUrls.slice(0, 8)) {
			try {
				const js = await this._fetchText(u);
				const m2 = /client_id["']?\s*[:=]\s*["']([a-zA-Z0-9_\-]{20,})["']/.exec(js);
				if (m2 && m2[1]) return m2[1];
			} catch (err) {
				// ignore script fetch errors
			}
		}

		// Not found
		return null;
	}

	async refreshOnce() {
		try {
			const id = await this.probeForClientId();
			if (id && typeof id === "string" && id.length > 8) {
				if (this.clientId && this.clientId !== id) {
					console.log("[SoundCloudKeyManager] client_id rotated (prefix):", id.slice(0, 6) + "...");
				} else if (!this.clientId) {
					console.log("[SoundCloudKeyManager] client_id discovered (prefix):", id.slice(0, 6) + "...");
				}
				this.clientId = id;
				return true;
			}
			console.warn("[SoundCloudKeyManager] client_id not found during probe");
			return false;
		} catch (err) {
			console.warn("[SoundCloudKeyManager] probe failed:", err && err.message ? err.message : err);
			return false;
		}
	}

	startBackground() {
		if (this.running) return;
		this.running = true;
		// initial immediate probe (non-blocking)
		this.refreshOnce();
		this.timer = setInterval(() => {
			this.refreshOnce();
		}, this.refreshIntervalMs);
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.running = false;
	}

	getClientId() {
		return this.clientId;
	}
}

// priority: environment variable > discovered key
const envSoundcloudClientId = process.env.SOUNDCLOUD_CLIENT_ID || process.env.SOUNDCLOUD_CLIENTID || null;
const scKeyManager = new SoundCloudKeyManager({ refreshIntervalMs: 6 * 60 * 60 * 1000 });
if (!envSoundcloudClientId) {
	// start background discovery if env not provided
	scKeyManager.startBackground();
} else {
	// still start background to auto-refresh if env provided
	scKeyManager.clientId = envSoundcloudClientId;
	scKeyManager.startBackground();
}

// Use the env value if present, otherwise fallback to whatever discovery returned so far
let initialSoundcloudClientId = envSoundcloudClientId || scKeyManager.getClientId() || null;

let soundcloudPlugin = null;
if (initialSoundcloudClientId) {
	// Dynamic import to avoid module top-level init when no key
	try {
		const pluginModule = require("@ziplayer/plugin");
		if (pluginModule && pluginModule.SoundCloudPlugin) {
			soundcloudPlugin = new pluginModule.SoundCloudPlugin({
				client_id: initialSoundcloudClientId,
				clientId: initialSoundcloudClientId,
			});
		} else {
			console.warn("[SoundCloud] SoundCloudPlugin not found in @ziplayer/plugin");
		}
	} catch (err) {
		console.warn("[SoundCloud] dynamic require failed (delayed init):", err && err.message ? err.message : err);
		// Do not crash; plugin will remain null and discovery will continue in background
	}
} else {
	console.log("[SoundCloud] No client_id available at startup — SoundCloud plugin disabled. Discovery running in background.");
}

const plugins = [
	...(soundcloudPlugin ? [soundcloudPlugin] : []),
	new YouTubePlugin(),
	new SpotifyPlugin(),
];

let player;
try {
	player = new PlayerManager({
		plugins,
	});
} catch (err) {
	console.error("[PlayerManager] failed to initialize:", err && err.stack ? err.stack : err);
	throw err;
}
// =============================

// Trình lắng nghe sự kiện của Player
player.on("trackStart", (queue, track) => {
	if (queue.userdata?.channel) {
		queue.userdata.channel.send(`▶ Started playing: **${track.title}**`);
	}
});

player.on("trackAdd", (queue, track) => {
	if (queue.userdata?.channel) {
		queue.userdata.channel.send(`✅ Added to queue: **${track.title}**`);
	}
});

player.on("error", (queue, error) => {
	console.log(`[${queue.guild.id}] Error emitted from the queue: ${error}`);
});

player.on("willPlay", (playerInstance, track, upcomming) => {
	console.log(`${track.title} will play next!`);
	if (playerInstance.userdata?.channel) {
		playerInstance.userdata.channel.send(
			`⏭ | Upcoming: **${track.title}**\n${upcomming.map((t) => `${t.title}`).join("\n")}`
		);
	}
});

client.on("clientReady", () => {
	console.log(`Logged in as ${client.user.tag}`);
});

// 3. Xử lý Lệnh
client.on("messageCreate", async (message) => {
	if (message.author.bot || !message.guild) return;
	if (!message.content.startsWith(prefix)) return;

	const args = message.content.slice(prefix.length).trim().split(/ +/g);
	const command = args.shift().toLowerCase();

	// Lệnh trợ giúp (Help)
	if (command === "help" || command === "h") {
		return message.channel.send(
			"📜 **DANH SÁCH LỆNH BOT NHẠC**\n\n" +
			"🎵 `!play <tên bài/URL>` (hoặc `!p`): Phát nhạc từ YouTube, Spotify, SoundCloud\n" +
			"⏭ `!skip` (hoặc `!s`): Bỏ qua bài hát hiện tại\n" +
			"⏸ `!pause`: Tạm dừng phát nhạc\n" +
			"▶ `!resume` (hoặc `!r`): Tiếp tục phát nhạc\n" +
			"⏹ `!stop`: Dừng phát nhạc và xóa hàng đợi\n" +
			"📜 `!queue` (hoặc `!q`): Xem danh sách bài hát trong hàng đợi\n" +
			"🔊 `!volume <0-100>` (hoặc `!vol`): Điều chỉnh âm lượng\n" +
			"🔁 `!autoplay`: Bật/Tắt chế độ tự động phát bài tiếp theo\n" +
			"🎧 `!nowplaying` (hoặc `!np`): Xem thông tin bài hát đang phát\n" +
			"👋 `!leave`: Ngắt kết nối bot khỏi kênh thoại"
		);
	}

	if (command === "play" || command === "p") {
		if (!args[0]) return message.channel.send("❌ | Please provide a song name or URL");
		if (!message.member.voice.channel) return message.channel.send("❌ | You must be in a voice channel");

		const queue = await player.create(message.guild.id, {
			userdata: {
				channel: message.channel,
			},
			selfDeaf: true,
		});

		try {
			if (!queue.connection) await queue.connect(message.member.voice.channel);
			const success = await queue.play(args.join(" ")).catch((e) => {
				console.log("Play error:", e && e.stack ? e.stack : e);
				return message.channel.send("❌ | No results found");
			});

			if (success) message.channel.send(`✅ | Enqueued **${args.join(" ")}**`);
		} catch (e) {
			console.log("Connect error:", e && e.stack ? e.stack : e);
			return message.channel.send("❌ | Could not join your voice channel");
		}
		return;
	}

	const queue = player.get(message.guild.id);
	if (!queue || !queue.isPlaying) return message.channel.send("❌ | No music is being played");

	if (command === "skip" || command === "s") {
		queue.skip();
		message.channel.send("⏭ | Skipped the current track");
	} else if (command === "autoplay") {
		queue.queue.autoPlay(!queue.queue.autoPlay());
		message.channel.send(`🔁 | Autoplay is now: **${queue.queue.autoPlay() ? "Enabled" : "Disabled"}`);
	} else if (command === "stop") {
		queue.stop();
		message.channel.send("⏹ | Stopped the music and cleared the queue");
	} else if (command === "pause") {
		if (queue.isPaused) return message.channel.send("❌ | Music is already paused");
		queue.pause();
		message.channel.send("⏸ | Paused the music");
	} else if (command === "resume" || command === "r") {
		if (!queue.isPaused) return message.channel.send("❌ | Music is not paused");
		queue.resume();
		message.channel.send("▶ | Resumed the music");
	} else if (command === "queue" || command === "q") {
		const current = queue.currentTrack;
		const list = queue.upcomingTracks
			.map((t, i) => `${i + 1}. ${t.title} - ${t.requestedBy}`)
			.slice(0, 10)
			.join("\n");
		message.channel.send(
			`**Current Track:**\n${current ? `${current.title} - ${current.requestedBy}` : "None"}\n\n**Queue:**\n${
				list.length > 0 ? list : "No more tracks in the queue"
			}`
		);
	} else if (command === "volume" || command === "vol") {
		if (!args[0]) return message.channel.send(`🔊 | Current volume is: **${queue.volume}**`);
		const volume = parseInt(args[0]);
		if (isNaN(volume) || volume < 0 || volume > 100)
			return message.channel.send("❌ | Volume must be a number between 0 and 100");
		queue.setVolume(volume);
		message.channel.send(`🔊 | Volume set to: **${volume}**`);
	} else if (command === "nowplaying" || command === "np") {
		const current = queue.currentTrack;
		const progress = queue.getProgressBar();
		message.channel.send(`▶ | Now playing: **${current ? current.title : "Unknown"}**\n${progress}`);
	} else if (command === "leave") {
		queue.destroy();
		message.channel.send("👋 | Left the voice channel");
	}
});

// Xử lý ngoại lệ tránh crash bot
process.on("uncaughtException", function (err) {
	console.error("Caught exception:", err && err.stack ? err.stack : err);
});

process.on("unhandledRejection", function (err) {
	console.error("Unhandled rejection:", err && err.stack ? err.stack : err);
});

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
