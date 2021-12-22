'use strict';

const http = require('http');
http.createServer(function (req, res) {
        res.write('online');
        res.end();
    }).listen(8080);

//discord.js(voice)
const { joinVoiceChannel, createAudioResource, createAudioPlayer, StreamType, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const { Client, MessageEmbed, Intents } = require('discord.js');
const client = new Client({
    intents: Object.keys(Intents.FLAGS)
});

//youtubeライブラリ群
const ytSearch = require('yt-search');
const ytdl = require('ytdl-core');

//各種設定等
const config = require('./config.json');
const player = createAudioPlayer()
const queue = new Map();
const Settings = {
    Global_volume: 0.3,
    isForceloop: true, //リピート再生が有効化されている場合、スキップを無効化するか
}

client.on('ready', () => {
    console.log('[INFO]Music Client started!');
    console.table({
        'Bot User:': client.user.tag,
        'Guild(s):': client.guilds.cache.size + 'Servers',
        'Watching:': client.guilds.cache.reduce((a, b) => a + b.memberCount, 0) + 'Members',
        'Prefix:': config.prefix,
        'Discord.js:': 'v' + require('discord.js').version,
        'Node.js:': process.version,
        'Plattform:': process.platform + '|' + process.arch,
        'Memory:': (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + 'MB |' + (process.memoryUsage().rss / 1024 / 1024).toFixed(2) + 'MB'
    });
});

client.on('messageCreate', async message => {
    const channel = message.member.voice.channel;
    if (!channel) message.channel.send("ボイスチャンネルに参加していません。");
    const server_queue = queue.get(message.guild.id);
    const args = message.content.slice(config.prefix.length).trim().split(/ +/g);

    if (message.content.startsWith(`${config.prefix}play`) && !server_queue) {
        if (!args.length) return message.channel.send('URLまたは検索ワードが入力されていません。');
        let song = {};

        if (ytdl.validateURL(args[1])) {
            const song_info = await ytdl.getInfo(args[1]);
            song = {
                title: song_info.videoDetails.title,
                url: song_info.videoDetails.video_url,
                thumbnail: song_info.videoDetails.thumbnails[0],
                time: song_info.videoDetails.lengthSeconds,
                views: song_info.videoDetails.viewCount,
            };
        } else {
            const video_finder = async query => {
                const video_result = await ytSearch(query);
                return video_result.videos.length > 1 ? video_result.videos[0] : null;
            };
            const video = await video_finder(args.join(' '));
            if (video) {
                const song_info = await ytdl.getInfo(video.url);
                song = {
                    title: song_info.videoDetails.title,
                    url: song_info.videoDetails.video_url,
                    thumbnail: song_info.videoDetails.thumbnails[0],
                    time: song_info.videoDetails.lengthSeconds,
                    views: song_info.videoDetails.viewCount,
                };
            } else {
                message.channel.send('該当する動画が見つかりませんでした。');
            }
        }

        let queue_constructor = {
            Guild: message.guild,
            text_channel: message.channel,
            volume: Number(Global_volume),
            connection: null,
            songs: [],
            loop: false,
            q_loop: false,
        };

        queue.set(message.guild.id, queue_constructor);
        queue_constructor.songs.push(song);

        const embed = new MessageEmbed()
            .setColor('RED')
            .setTitle(':notes:再生中')
            .setImage(`${song.thumbnail.url}`)
            .addField(':tv:動画:', `${song.title}`)
            .addField(':link:URL:', `${song.url}`)
            .setFooter(`👀再生回数: ${song.views}回`);
        message.channel.send({
            embeds: [embed]
        });
        try {
            const connection = joinVoiceChannel({
                adapterCreator: message.guild.voiceAdapterCreator,
                channelId: channel.id,
                guildId: channel.guild.id,
                selfDeaf: true,
                selfMute: false,
            });
            queue_constructor.connection = connection;
            video_player(message.guild, queue_constructor);
        } catch (err) {
            queue.delete(message.guild.id);
            message.channel.send('接続エラーが発生しました。権限が適切でないか、技術的な問題が発生しました。');
            throw err;
        }
    } else {
        server_queue.songs.push(song);
        return message.channel.send(`:notes:**${song.title}** をキューに追加しました。`);
    }
    if (message.content.startsWith(`${config.prefix}skip`))
        skip_song(message, channel);
    if (message.content.startsWith(`${config.prefix}stop`))
        stop_song(message, server_queue);
    if (message.content.startsWith(`${config.prefix}loop`))
        loop_song(message, channel);
    if (message.content.startsWith(`${config.prefix}aloop`))
        queue_loop(message, channel);
});

const video_player = async (guild) => {
    const song_queue = queue.get(guild.id);
    song_queue.connection.subscribe(player);
    if (!song_queue.songs[0]) return queue.delete(guild.id);
    const stream = ytdl(song_queue.songs[0].url, {
        filter: format => format.audioCodec === 'opus' && format.container === 'webm',
        quality: 'highest',
        highWaterMark: 32 * 1024 * 1024
    });
    const resource = createAudioResource(stream, {
        inputType: StreamType.WebmOpus
    });
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 10 * 1000);
    console.info('[INFO]再生を開始するよ');
    await entersState(player, AudioPlayerStatus.Idle, 24 * 60 * 60 * 1000);
    console.log('[INFO]再生中の楽曲が終了したよ。');

    if (song_queue.loop) video_player(song_queue.Guild);
    if (song_queue.q_loop) {
        song_queue.songs.push(song_queue.songs.shift());
        video_player(song_queue.Guild);
    }
    else {
        song_queue.songs.shift();
        video_player(song_queue.Guild);
    }
};

const skip_song = (message, channel) => {
    if (!channel) return message.channel.send('ボイスチャンネルに参加していません');
    const song_queue = queue.get(message.guild.id);
    if (!song_queue) return message.channel.send('キューに曲がありません。');
    if (isForceloop) return;
    song_queue.songs.shift();
    video_player(song_queue.Guild);
};

const stop_song = (message, server_queue) => {
    if (!message.member.voice.channel) return message.channel.send('ボイスチャンネルに参加していません。');
    if (!server_queue.connection === null) return;
    server_queue.connection.destroy();
    queue.delete(server_queue.Guild.id);
    const embed = new MessageEmbed()
        .setColor('RED')
        .setTitle('⏹再生を終了しました')
        .setThumbnail(message.author.avatarURL({ dynamic: true }))
        .setFooter(`実行者:${message.author.tag}`);
    message.channel.send({ embeds: [embed] });
};

const loop_song = async (message, channel) => {
    const song_queue = queue.get(message.guild.id);
    if (!channel) return message.channel.send('ボイスチャンネルに参加していません。');
    if (!song_queue) return message.channel.send('音楽が再生されてません');
    song_queue.loop = !song_queue.loop;
    await message.channel.send(`:repeat:ループを${song_queue.loop ? `有効` : `無効`}にしました`);
}

const queue_loop = async (message, channel) => {
    const song_queue = queue.get(message.guild.id);
    if (!channel) return message.channel.send("音声チャンネルにいる必要があります。");
    if (!song_queue) return message.channel.send("音楽が再生されてません");
    song_queue.q_loop = !song_queue.q_loop;
    await message.channel.send(`:repeat:全曲ループを${song_queue.q_loop ? `有効` : `無効`}にしました。`);
}

client.on('threadCreate', async thread => {
    try {
        if (thread.joinable && !thread.joined) await thread.join();
    } catch (e) { console.warn(`[ERROR]${e}`); }
});

client.login('');
