import { PlayerManager } from "ziplayer";
import { Client, GatewayIntentBits } from "discord.js";
import { SoundCloudPlugin, YouTubePlugin, SpotifyPlugin } from "@ziplayer/plugin";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

// 1. Web Server Keep-Alive cho Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot đang chạy 24/7!"));
app.listen(PORT, () => console.log(`Web server đang chạy ở cổng ${PORT}`));

// 2. Cấu hình Discord Bot
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMembers,
	],
});

// Setup plugins & Player Manager
const soundcloudPlugin = new SoundCloudPlugin();
const youtubePlugin = new YouTubePlugin();
const spotifyPlugin = new SpotifyPlugin();

const manager = new PlayerManager({
	plugins: [soundcloudPlugin, youtubePlugin, spotifyPlugin],
});

// Lắng nghe sự kiện đăng nhập
client.on("clientReady", () => {
	console.log(`Logged in as ${client.user?.tag}`);
});

// 3. Xử lý Lệnh Tin Nhắn
client.on("messageCreate", async (message) => {
	if (message.author.bot || !message.guild) return;
	
	if (message.content.startsWith("!")) {
		console.log(`[Message Received] ${message.author.tag}: ${message.content}`);
	} else {
		return;
	}

	const args = message.content.slice(1).trim().split(/ +/);
	const command = args.shift()?.toLowerCase();

	if (command === "play" || command === "p") {
		const query = args.join(" ");
		if (!query) return message.reply("Please provide a song to play!");

		const member = message.member;
		const voiceChannel = member?.voice.channel;

		if (!voiceChannel) {
			return message.reply("You need to be in a voice channel!");
		}

		// Kiểm tra quyền kết nối và nói trong kênh voice
		const permissions = voiceChannel.permissionsFor(message.client.user);
		if (!permissions.has("Connect") || !permissions.has("Speak")) {
			return message.reply("❌ Bot needs Connect and Speak permissions in your voice channel!");
		}

		try {
			const player = await manager.create(message.guild.id, {
				leaveOnEnd: false,
				leaveOnEmpty: false,
				userdata: {
					voiceChannel: voiceChannel,
					textChannel: message.channel,
				},
			});

			if (!player.connection) {
				await player.connect(voiceChannel);
			}

			const success = await player.play(query, message.author.id);

			if (success) {
				message.reply(`🎵 Added to queue: **${query}**`);
			} else {
				message.reply("❌ Failed to add song to queue");
			}
		} catch (error) {
			console.error("Play command error:", error);
			message.reply("❌ An error occurred while trying to play the song");
		}
	}

	if (command === "skip" || command === "s") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("No music is playing!");

		player.skip();
		message.reply("⏭️ Skipped current track");
	}

	if (command === "pause") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("No music is playing!");

		if (player.pause()) {
			message.reply("⏸️ Paused playback");
		} else {
			message.reply("❌ Could not pause playback");
		}
	}

	if (command === "resume" || command === "r") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("No music is playing!");

		if (player.resume()) {
			message.reply("▶️ Resumed playback");
		} else {
			message.reply("❌ Could not resume playback");
		}
	}

	if (command === "queue" || command === "q") {
		const player = manager.get(message.guild.id);
		if (!player || player.queueSize === 0) {
			return message.reply("Queue is empty!");
		}

		const current = player.currentTrack;
		const upcoming = player.upcomingTracks.slice(0, 10);

		let queueText = "";
		if (current) {
			queueText += `**Now Playing:** ${current.title}\n\n`;
		}

		if (upcoming.length > 0) {
			queueText += "**Up Next:**\n";
			upcoming.forEach((track, index) => {
				queueText += `${index + 1}. ${track.title}\n`;
			});
		}

		message.reply(queueText || "Queue is empty!");
	}

	if (command === "volume" || command === "vol") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("No music is playing!");

		const volume = parseInt(args[0]);
		if (isNaN(volume) || volume < 0 || volume > 200) {
			return message.reply("Please provide a volume between 0 and 200!");
		}

		player.setVolume(volume);
		message.reply(`🔊 Volume set to ${volume}%`);
	}

	if (command === "stop") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("No music is playing!");

		player.stop();
		message.reply("⏹️ Stopped playback and cleared queue");
	}

	if (command === "shuffle") {
		const player = manager.get(message.guild.id);
		if (!player || player.queueSize === 0) {
			return message.reply("Queue is empty!");
		}

		player.shuffle();
		message.reply("🔀 Shuffled the queue");
	}
});

// Event listeners cho Player Manager
manager.on("trackStart", (player, track) => {
	player.userdata.textChannel.send(`🎶 Now playing: **${track.title}**`);
	console.log(`Started playing: ${track.title} in guild ${player.guildId}`);
});

manager.on("trackEnd", (player, track) => {
	player.userdata.textChannel.send(`✅ Finished playing: **${track.title}**`);
	console.log(`Finished playing: ${track.title} in guild ${player.guildId}`);
});

manager.on("queueEnd", (player) => {
	player.userdata.textChannel.send("🏁 Queue has ended.");
	console.log(`Queue ended in guild ${player.guildId}`);
});

manager.on("playerError", (player, error, track) => {
	console.error(`Player error in guild ${player.guildId}:`, error.message);
});

client.login(process.env.DISCORD_TOKEN);
