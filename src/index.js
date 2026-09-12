require("dotenv").config();
const express = require("express");
const { PlayerManager } = require("ziplayer");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { YouTubePlugin, SpotifyPlugin } = require("@ziplayer/plugin");
const play = require("play-dl");

// 1. Web Server Keep-Alive
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

const plugins = [
	new YouTubePlugin(),
	new SpotifyPlugin(),
];

let player;
try {
	player = new PlayerManager({ plugins });
} catch (err) {
	console.error("[PlayerManager] failed to initialize:", err && err.stack ? err.stack : err);
	throw err;
}

// === EVENT TRẢ LỜI KHI PHÁT NHẠC ===
player.on("trackStart", (queue, track) => {
	if (queue.userdata?.channel) {
		const embed = new EmbedBuilder()
			.setColor("#FF5500")
			.setTitle("🎶 Đang phát nhạc")
			.setDescription(`[${track.title}](${track.url || track.uri || "#"})`)
			.addFields(
				{ name: "👤 Tác giả / Kênh", value: track.author || track.artist || "SoundCloud", inline: true },
				{ name: "⏱️ Thời lượng", value: track.duration ? `${track.duration}` : "Live / Không rõ", inline: true }
			)
			.setThumbnail(track.thumbnail || track.artworkUrl || null)
			.setFooter({ text: "Chúc bạn nghe nhạc vui vẻ! 🎧" });

		queue.userdata.channel.send({ embeds: [embed] }).catch(() => {
			queue.userdata.channel.send(`▶ **Đang phát:** **${track.title}**`);
		});
	}
});

player.on("trackAdd", (queue, track) => {
	if (queue.userdata?.channel) {
		queue.userdata.channel.send(`✅ **Đã thêm vào hàng đợi:** **${track.title}**`);
	}
});

player.on("error", (queue, error) => {
	console.log(`[${queue.guild.id}] Error emitted from the queue: ${error}`);
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

	// === LỆNH TRỢ GIÚP (HELP) ===
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
		if (!args[0]) return message.channel.send("❌ | Vui lòng nhập tên bài hát hoặc đường link!");
		if (!message.member.voice.channel) return message.channel.send("❌ | Bạn phải tham gia một kênh thoại trước!");

		let inputUrl = args.join(" ");
		const statusMsg = await message.channel.send(`🔍 **Đang xử lý nguồn SoundCloud...**`);

		try {
			// Giải mã link rút gọn on.soundcloud.com nếu có
			if (inputUrl.includes("on.soundcloud.com")) {
				try {
					const response = await fetch(inputUrl, { method: "HEAD", redirect: "follow" });
					inputUrl = response.url;
				} catch (err) {
					console.error("Lỗi giải mã link rút gọn SoundCloud:", err);
				}
			}

			const queue = await player.create(message.guild.id, {
				userdata: { channel: message.channel },
				selfDeaf: true,
			});

			if (!queue.connection) {
				await queue.connect(message.member.voice.channel);
			}

			// Nếu phát link SoundCloud
			if (inputUrl.includes("soundcloud.com")) {
				const info = await play.soundcloud(inputUrl).catch((e) => {
					console.error("SoundCloud Fetch Error:", e);
					return null;
				});

				if (!info) {
					return statusMsg.edit("❌ | Không thể tải bài hát từ link SoundCloud này.").catch(() => {});
				}

				const streamData = await play.stream(inputUrl);

				await queue.play(streamData.stream, {
					type: streamData.type,
					title: info.name || "SoundCloud Track",
					author: info.user?.name || "SoundCloud",
					url: inputUrl,
					thumbnail: info.thumbnail || null,
					duration: info.durationInSec || 0,
				});

				statusMsg.edit(`🔎 **Đã tải phát trực tiếp từ SoundCloud:** \`${info.name}\``).catch(() => {});
			} else {
				// Phát qua YouTube/Spotify mặc định nếu không phải link SoundCloud
				const track = await queue.play(inputUrl);
				if (!track) return statusMsg.edit("❌ | Không tìm thấy bài hát.");
				statusMsg.edit(`🔎 **Đã tải xong:** \`${track.title}\``).catch(() => {});
			}

		} catch (e) {
			console.error("Play error:", e);
			return statusMsg.edit("❌ | Lỗi phát nhạc từ SoundCloud. SoundCloud chặn IP hoặc bài viết riêng tư.").catch(() => {});
		}
		return;
	}

	const queue = player.get(message.guild.id);
	if (!queue || !queue.isPlaying) return message.channel.send("❌ | Hiện tại không có nhạc đang phát");

	if (command === "skip" || command === "s") {
		queue.skip();
		message.channel.send("⏭ | Đã bỏ qua bài hát hiện tại");
	} else if (command === "autoplay") {
		queue.queue.autoPlay(!queue.queue.autoPlay());
		message.channel.send(`🔁 | Chế độ Tự động phát hiện là: **${queue.queue.autoPlay() ? "Bật" : "Tắt"}**`);
	} else if (command === "stop") {
		queue.stop();
		message.channel.send("⏹ | Đã dừng phát nhạc và xóa danh sách chờ");
	} else if (command === "pause") {
		if (queue.isPaused) return message.channel.send("❌ | Nhạc đã tạm dừng rồi");
		queue.pause();
		message.channel.send("⏸ | Đã tạm dừng phát nhạc");
	} else if (command === "resume" || command === "r") {
		if (!queue.isPaused) return message.channel.send("❌ | Nhạc vẫn đang phát bình thường");
		queue.resume();
		message.channel.send("▶ | Tiếp tục phát nhạc");
	} else if (command === "queue" || command === "q") {
		const current = queue.currentTrack;
		const list = queue.upcomingTracks
			.map((t, i) => `${i + 1}. ${t.title} - ${t.requestedBy}`)
			.slice(0, 10)
			.join("\n");
		message.channel.send(
			`**Bài hát đang phát:**\n${current ? `${current.title} - ${current.requestedBy}` : "Không có"}\n\n**Danh sách chờ:**\n${
				list.length > 0 ? list : "Không có bài hát nào trong hàng đợi"
			}`
		);
	} else if (command === "volume" || command === "vol") {
		if (!args[0]) return message.channel.send(`🔊 | Âm lượng hiện tại: **${queue.volume}**`);
		const volume = parseInt(args[0]);
		if (isNaN(volume) || volume < 0 || volume > 100)
			return message.channel.send("❌ | Âm lượng phải là một số từ 0 đến 100");
		queue.setVolume(volume);
		message.channel.send(`🔊 | Đã chỉnh âm lượng thành: **${volume}**`);
	} else if (command === "nowplaying" || command === "np") {
		const current = queue.currentTrack;
		const progress = queue.getProgressBar();
		message.channel.send(`▶ | Đang phát: **${current ? current.title : "Không rõ"}**\n${progress}`);
	} else if (command === "leave") {
		queue.destroy();
		message.channel.send("👋 | Đã rời khỏi kênh thoại");
	}
});

process.on("uncaughtException", (err) => console.error("Uncaught:", err));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
