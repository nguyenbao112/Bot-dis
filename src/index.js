require("dotenv").config();
const express = require("express");
const { PlayerManager } = require("ziplayer");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { YouTubePlugin, SpotifyPlugin } = require("@ziplayer/plugin");
const scdl = require("soundcloud-downloader").default;

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
	player = new PlayerManager({
		plugins,
	});
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

	if (command === "play" || command === "p") {
		if (!args[0]) return message.channel.send("❌ | Vui lòng nhập tên bài hát hoặc đường link!");
		if (!message.member.voice.channel) return message.channel.send("❌ | Bạn phải tham gia một kênh thoại trước!");

		let inputUrl = args.join(" ");
		const statusMsg = await message.channel.send(`🔍 **Đang xử lý nguồn SoundCloud:** \`${inputUrl}\`...`);

		try {
			// Giải mã link rút gọn on.soundcloud.com nếu có
			if (inputUrl.includes("on.soundcloud.com")) {
				try {
					const res = await fetch(inputUrl, { redirect: "follow" });
					inputUrl = res.url;
				} catch (e) {
					console.error("Lỗi giải mã link SoundCloud rút gọn:", e);
				}
			}

			const queue = await player.create(message.guild.id, {
				userdata: {
					channel: message.channel,
				},
				selfDeaf: true,
			});

			if (!queue.connection) {
				await queue.connect(message.member.voice.channel);
			}

			// Nếu là link SoundCloud trực tiếp
			if (inputUrl.includes("soundcloud.com")) {
				const clientID = process.env.SOUNDCLOUD_CLIENT_ID;
				
				// Lấy thông tin bài hát trực tiếp qua SCDL
				const info = await scdl.getInfo(inputUrl, clientID).catch((err) => {
					console.error("SCDL Error:", err);
					return null;
				});

				if (!info) {
					return statusMsg.edit("❌ | SoundCloud đã chặn IP Render hoặc Link không tồn tại. Vui lòng cập nhật `SOUNDCLOUD_CLIENT_ID` mới.").catch(() => {});
				}

				// Lấy luồng phát audio
				const stream = await scdl.download(inputUrl, clientID);

				await queue.play(stream, {
					title: info.title || "SoundCloud Track",
					author: info.user?.username || "SoundCloud",
					url: inputUrl,
					thumbnail: info.artwork_url || null,
					duration: info.duration ? Math.floor(info.duration / 1000) : 0,
				});

				statusMsg.edit(`🔎 **Đã tải phát trực tiếp từ SoundCloud:** \`${info.title}\``).catch(() => {});
			} else {
				// Nếu không phải link SoundCloud thì phát qua plugin mặc định
				const track = await queue.play(inputUrl);
				if (!track) return statusMsg.edit("❌ | Không tìm thấy bài hát.");
				statusMsg.edit(`🔎 **Đã tải xong:** \`${track.title}\``).catch(() => {});
			}

		} catch (e) {
			console.error("Play error:", e);
			return statusMsg.edit("❌ | Lỗi phát nhạc. SoundCloud chặn truy cập từ Server Cloud.").catch(() => {});
		}
		return;
	}

	const queue = player.get(message.guild.id);
	if (!queue || !queue.isPlaying) return message.channel.send("❌ | Hiện tại không có nhạc đang phát");

	if (command === "skip" || command === "s") {
		queue.skip();
		message.channel.send("⏭ | Đã bỏ qua bài hát hiện tại");
	} else if (command === "stop") {
		queue.stop();
		message.channel.send("⏹ | Đã dừng phát nhạc và xóa danh sách chờ");
	} else if (command === "pause") {
		queue.pause();
		message.channel.send("⏸ | Đã tạm dừng phát nhạc");
	} else if (command === "resume" || command === "r") {
		queue.resume();
		message.channel.send("▶ | Tiếp tục phát nhạc");
	} else if (command === "leave") {
		queue.destroy();
		message.channel.send("👋 | Đã rời khỏi kênh thoại");
	}
});

process.on("uncaughtException", (err) => console.error("Uncaught:", err));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
