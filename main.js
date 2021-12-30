'use strict';

const http = require('node:http');
http.createServer((_, res) => {
        res.write('online');
        res.end();
    }).listen(8080);

//discord.js(voice)
const { joinVoiceChannel, createAudioResource, createAudioPlayer, StreamType, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const { Client, MessageEmbed, Intents, version: djs_version } = require('discord.js');
const client = new Client({
    intents: Object.keys(Intents.FLAGS)
});

//youtubeライブラリ群
const ytSearch = require('yt-search');
const ytdl = require('ytdl-core');

//各種設定等
const config = require('./config.json');
const queue_map = new Map();
const settings = {
    global_volume: 0.3,
    is_force_loop: true //リピート再生が有効化されている場合、スキップを無効化するか
}

client.on('ready', () => {
    console.log('[INFO]Music Client started!');
    console.table({
        'Bot User': client.user.tag,
        'Guild(s)': client.guilds.cache.size + ' Servers',
        'Watching': client.guilds.cache.reduce((a, b) => a + b.memberCount, 0) + ' Members',
        'Prefix': config.prefix,
        'Discord.js': 'v' + djs_version,
        'Node.js': process.version,
        'Plattform': process.platform + ' | ' + process.arch,
        'Memory': (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + 'MB | ' + (process.memoryUsage().rss / 1024 / 1024).toFixed(2) + 'MB'
    });
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild || !message.member) return;
    const server_queue = queue_map.get(message.guild.id);
    try {
        if (message.content.startsWith(`${config.prefix}play`)) 
            return await play_request(message, server_queue);
        if (message.content.startsWith(`${config.prefix}skip`))
            return await skip_song(message, server_queue);
        if (message.content.startsWith(`${config.prefix}stop`))
            return await stop_song(message, server_queue);
        if (message.content.startsWith(`${config.prefix}loop`))
            return await loop_song(message, server_queue);
        if (message.content.startsWith(`${config.prefix}aloop`))
            return await loop_queue(message, server_queue);
    } catch (err) {
        console.error(err);
    }
});

const play_request = async (message, server_queue) => {
    // check if the user is in a voice channel
    const voice_channel = message.member.voice.channel;
    if (server_queue) {
        if (server_queue.voice_channel_id !== voice_channel?.id) 
            return await message.channel.send(`<#${server_queue.voice_channel_id}>に参加してください。`);
    } else {
        if (!voice_channel) 
            return await message.channel.send("ボイスチャンネルに参加してください。");
    }

    // check if the arguments are valid
    const args = message.content.slice(config.prefix.length).trim().split(/\s+/g);
    if (args.length < 2) return await message.channel.send('URLまたは検索ワードが入力されていません。');

    // resolve the song url
    const url = await resolve_song_url(args);
    if (!url) return await message.channel.send('該当する動画が見つかりませんでした。');

    // fetch the song info
    const song_info = await ytdl.getInfo(url);
    const song = {
        title: song_info.videoDetails.title,
        url: song_info.videoDetails.video_url,
        thumbnail: song_info.videoDetails.thumbnails[0],
        time: song_info.videoDetails.lengthSeconds,
        views: song_info.videoDetails.viewCount
    };

    // if thw queue exists, add the song to it
    if (server_queue) {
        server_queue.songs.push(song);
        return await message.channel.send(`:notes:**${song.title}** をキューに追加しました。`);
    }

    // otherwise create a new queue and add the song to it
    try {
        const connection = joinVoiceChannel({
            adapterCreator: message.guild.voiceAdapterCreator,
            channelId: voice_channel.id,
            guildId: voice_channel.guild.id,
            selfDeaf: true,
            selfMute: false,
        });
        const player = createAudioPlayer();
        connection.subscribe(player);
        queue_map.set(message.guild.id, {
            text_channel: message.channel,
            voice_channel_id: voice_channel.id,
            volume: settings.global_volume,
            songs: [ song ],
            loop: false,
            q_loop: false,
            connection,
            player
        });

        // send a message to the channel
        const embed = new MessageEmbed()
            .setColor('RED')
            .setTitle(':notes: 再生中')
            .setImage(`${song.thumbnail.url}`)
            .addField(':tv: 動画:', `${song.title}`)
            .addField(':link: URL:', `${song.url}`)
            .setFooter({ text: `\ud83d\udc40再生回数: ${song.views}回` });    
        await message.channel.send({ embeds: [embed] });

        await video_player(message.guild.id);
    } catch (err) {
        await message.channel.send('接続エラーが発生しました。権限が適切でないか、技術的な問題が発生しました。');
        throw err;
    }
}

const resolve_song_url = async (args) => {
    if (ytdl.validateURL(args[1])) return args[1];
    const video_result = await ytSearch(args.slice(1).join(' '));
    return 1 < video_result.videos.length ? video_result.videos[0].url : null;
};

const video_player = async (guild_id) => {
    // get the queue
    const song_queue = queue_map.get(guild_id);
    if (!song_queue?.songs[0]) return queue_map.delete(guild_id);

    // fecth the song's data
    const stream = ytdl(song_queue.songs[0].url, {
        filter: format => format.audioCodec === 'opus' && format.container === 'webm',
        quality: 'highest',
        highWaterMark: 32 * 1024 * 1024
    });
    const resource = createAudioResource(stream, {
        inputType: StreamType.WebmOpus
    });
    song_queue.player.play(resource);

    // play it and wait for the end
    await entersState(song_queue.player, AudioPlayerStatus.Playing, 10 * 1000);
    console.info('[INFO]再生を開始するよ');
    await entersState(song_queue.player, AudioPlayerStatus.Idle, 24 * 60 * 60 * 1000);
    console.log('[INFO]再生中の楽曲が終了したよ。');

    // when finished
    if (song_queue.loop) return video_player(guild_id);
    if (song_queue.q_loop) {
        song_queue.songs.push(song_queue.songs.shift());
        return video_player(guild_id);
    }
    song_queue.songs.shift();
    video_player(guild_id);
};

const skip_song = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    if (settings.is_force_loop && song_queue.loop) return;
    song_queue.player.stop();
    song_queue.songs.shift();
    video_player(message.guild.id);
};

const stop_song = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    song_queue.connection.destroy();
    queue_map.delete(message.guild.id);
    const embed = new MessageEmbed()
        .setColor('RED')
        .setTitle('⏹再生を終了しました')
        .setThumbnail(message.author.avatarURL({ dynamic: true }))
        .setFooter({ text: `実行者:${message.author.tag}` });
    await message.channel.send({ embeds: [embed] });
};

const loop_song = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    song_queue.loop = !song_queue.loop;
    await message.channel.send(`:repeat:ループを${song_queue.loop ? `有効` : `無効`}にしました`);
};

const loop_queue = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    song_queue.q_loop = !song_queue.q_loop;
    await message.channel.send(`:repeat:全曲ループを${song_queue.q_loop ? `有効` : `無効`}にしました。`);
};

const check_state_invalid = async (message) => {
    const song_queue = queue_map.get(message.guild.id);
    if (!song_queue) {
        await message.channel.send('音楽が再生されてません');
        return true;
    }
    const voice_channel_id = message.member.voice.channel?.id;
    if (song_queue.voice_channel_id !== voice_channel_id) {
        await message.channel.send(`<#${song_queue.voice_channel_id}>に参加してください。`);
        return true;
    }
    return false;
};

client.on('threadCreate', async thread => {
    try {
        if (thread.joinable && !thread.joined) await thread.join();
    } catch (e) { 
        console.warn(`[ERROR]${e}`);
    }
});

client.login(DISCORD_BOT_TOKEN);
