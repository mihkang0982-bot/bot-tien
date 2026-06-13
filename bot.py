import discord
from discord.ext import commands
import os

TOKEN = os.getenv("TOKEN")

intents = discord.Intents.default()
intents.voice_states = True
intents.guilds = True

bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f"Đã đăng nhập: {bot.user}")
  
    channel_id = 1490092888539926711  

    channel = bot.get_channel(channel_id)

    if channel is not None:
        vc = await channel.connect()

        # 👉 tắt mic + tắt loa
        await vc.guild.change_voice_state(
            channel=channel,
            self_mute=True,
            self_deaf=True
        )

        print("Đã vào voice + tắt mic, loa")
    else:
        print("Không tìm thấy channel")

if not TOKEN:
    print("❌ Không tìm thấy TOKEN")
else:
    print("✅ TOKEN OK")
    bot.run(TOKEN)
