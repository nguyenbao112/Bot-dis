require("dotenv").config();
const express = require("express");
const { PlayerManager } = require("ziplayer");
const { Client, GatewayIntentBits } = require("discord.js");
const { SoundCloudPlugin, YouTubePlugin, SpotifyPlugin } = require("@ziplayer/plugin");

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

const player = new PlayerManager({
	plugins: [new SoundCloudPlugin(), new YouTubePlugin(), new SpotifyPlugin()],
});

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
				console.log("Play error:", e);
				return message.channel.send("❌ | No results found");
			});

			if (success) message.channel.send(`✅ | Enqueued **${args.join(" ")}**`);
		} catch (e) {
			console.log("Connect error:", e);
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
		message.channel.send(`🔁 | Autoplay is now: **${queue.queue.autoPlay() ? "Enabled" : "Disabled"}**`);
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
	console.log("Caught exception: " + err);
});

process.on("unhandledRejection", function (err) {
	console.log("Handled rejection: " + err);
});

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
