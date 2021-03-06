'use strict';

//discord.js(voice)
const { joinVoiceChannel, createAudioResource, createAudioPlayer, StreamType, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const { Client, MessageEmbed, Intents, version: djs_version } = require('discord.js');
const client = new Client({
    intents: Object.keys(Intents.FLAGS)
});

//youtubeライブラリ群
const ytSearch = require('yt-search');
const ytdl = require('ytdl-core');
const ytpl = require('ytpl');

//各種設定等
const settings = {
    global_volume: 1,
    is_force_loop: true,  //リピート再生が有効化されている場合、スキップを無効化するか
    repl_it_mode: false,  //repl.it(replit.com)を使用する場合はtrueに設定してください。
}
if (!settings.repl_it_mode) {
    require('dotenv').config({
        path: './.env',
    });
} else {
    globalThis.requireFile = filePath => require(path.join(process.cwd(), filePath));
    const http = require('node:http');
    http.createServer((_, res) => {
        res.write('online');
        res.end();
    }).listen(8080);
}
const { seconds_to_time, format_viewcount } = require('./Util/NumConvert');
const { random } = require('./Util/random');
const config = require('./config.json');
const queue_map = new Map();

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
    client.user.setActivity('Musicbot | Make by Nich87', { type: 'LISTENING' });
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild || !message.member) return;
    const server_queue = queue_map.get(message.guild.id);
    try {
        if (message.content.startsWith(`${config.prefix}help`))
            return await show_help(message, server_queue);
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
        if (message.content.startsWith(`${config.prefix}queue`))
            return await show_queue(message, server_queue);
        if (message.content.startsWith(`${config.prefix}volume`))
            return await change_volume(message, server_queue);
        if (message.content.startsWith(`${config.prefix}pause`))
            return await pause_song(message, server_queue);
        if (message.content.startsWith(`${config.prefix}resume`))
            return await resume_song(message, server_queue);
        if (message.content.startsWith(`${config.prefix}shuffle`))
            return await shuffle_queue(message, server_queue);
    } catch (e) {
        console.error(e);
    }
});

const play_request = async (message, server_queue) => {
    // check if the user is in a voice channel
    const voice_channel = message.member.voice.channel;
    if (server_queue) {
        if (server_queue.voice_channel_id !== voice_channel?.id)
            return await message.channel.send(`<#${server_queue.voice_channel_id}>に参加してください。`);
    } else {
        if (!voice_channel) return await message.channel.send("ボイスチャンネルに参加してください。");
        await Setup(message, voice_channel);
        server_queue = queue_map.get(message.guild.id);
    }

    // check if the arguments are valid
    const args = message.content.slice(config.prefix.length).trim().split(/\s+/g);
    if (args.length < 2) return await message.channel.send('URLまたは検索ワードが入力されていません。');
    // fetch the song info
    const isSong = url => ytdl.validateURL(url);
    const isPlaylist = url => ytpl.validateID(url);
    const isResult = async query => {
        const Result = await ytSearch(query);
        return 1 <= Result.videos.length ? Result.videos[0].url : null;
    };

    if (isSong(args[1])) {
        const song_info = await ytdl.getInfo(args[1]);
        const song = {
            title: song_info.videoDetails.title,
            url: song_info.videoDetails.video_url,
            thumbnail: song_info.videoDetails.thumbnails[0],
            time: song_info.videoDetails.lengthSeconds,
            views: song_info.videoDetails.viewCount
        };
        if (server_queue.songs[0]) {
            server_queue.songs.push(song);
            return await message.channel.send(`:notes:**${song.title}** をキューに追加しました。`);
        }
    }

    else if (isPlaylist(args[1])) {
        const song_info = await ytpl(args[1]);
        for (const item of song_info.items) {
            const viewcount = await ytdl.getInfo(item.shortUrl);
            const song = {
                title: item.title,
                url: item.shortUrl,
                thumbnail: item.thumbnails[0],
                time: item.durationSec,
                index: item.index,
                views: viewcount.videoDetails.viewCount
            };
            server_queue.songs.push(song);
        }
        let times = 0;
        song_info.items.forEach(items => times += items.durationSec);
        await message.channel.send(`:notes:**${song_info.estimatedItemCount}曲(${seconds_to_time(times)})** をキューに追加しました。`);
    } else {
            const song_info = await ytdl.getInfo(await isResult(args[1]));
            const song = {
                title: song_info.videoDetails.title,
                url: song_info.videoDetails.video_url,
                thumbnail: song_info.videoDetails.thumbnails[0],
                time: song_info.videoDetails.lengthSeconds,
                views: song_info.videoDetails.viewCount
            };
            server_queue.songs.push(song);
    }

    try {
        // send a message to the channel
        server_queue = queue_map.get(message.guild.id);
        const embed = new MessageEmbed()
            .setColor('RED')
            .setTitle(':notes: 再生中')
            .setImage(`${server_queue.songs[0].thumbnail.url}`)
            .addField(':tv: 動画:', `${server_queue.songs[0].title}`)
            .addField(':link: URL:', `${server_queue.songs[0].url}`)
            .setFooter({ text: `\ud83d\udc40再生回数: ${format_viewcount(server_queue.songs[0].views)}回` });
        await message.channel.send({ embeds: [embed] });
        await video_player(message.guild.id,message);
    } catch (e) {
        await message.channel.send('接続エラーが発生しました。権限が適切でないか、技術的な問題が発生しました。');
        throw e;
    }
}

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

const Setup = async (message, voice_channel) => {
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
            resource: null,
            songs: [],
            loop: false,
            q_loop: false,
            connection,
            player,
        });
    } catch (e) {
        await message.channel.send('接続エラーが発生しました。権限が適切でないか、技術的な問題が発生しました。');
        throw e;
    }
};

const video_player = async (guild_id,message) => {
    // get the queue
    const song_queue = queue_map.get(guild_id);
    if (!song_queue?.songs[0]) return queue_map.delete(guild_id);
    // fecth the song's data
    const stream = ytdl(song_queue.songs[0].url, {
        filter: format => format.audioCodec === 'opus' && format.container === 'webm',
        quality: 'highest',
        highWaterMark: 32 * 1024 * 1024,
    });
    const resource = createAudioResource(stream, {
        inputType: StreamType.WebmOpus,
        inlineVolume: true,
    })
    resource.volume.setVolume(settings.global_volume)

    song_queue.resource = resource;
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
    video_player(message.guild.id,message);
};

const stop_song = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    song_queue.connection.destroy();
    queue_map.delete(message.guild.id);
    message.channel.topic = temp_topic;
    const embed = new MessageEmbed()
        .setColor('RED')
        .setTitle('⏹再生を終了しました')
        .setThumbnail(message.author.avatarURL({ dynamic: true }))
        .setFooter({ text: `実行者:${message.author.tag}` });
    await message.channel.send({ embeds: [embed] });
};

const pause_song = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    if (song_queue.connection.state.status === 'paused') return message.channel.send('再生中の楽曲はすでに一時停止されています。');
    song_queue.player.pause();
    const embed = new MessageEmbed()
        .setColor('RED')
        .setTitle('⏸再生を一時停止しました')
        .setDescription(`再開するには**${config.prefix}resume**を実行してください。`)
        .setThumbnail(message.author.avatarURL({ dynamic: true }))
        .setFooter({ text: `実行者:${message.author.tag}` })
    await message.channel.send({ embeds: [embed] });
};

const resume_song = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    if (song_queue.connection.state.starus === 'playing') return message.channel.send('既に再生中です。');
    song_queue.player.unpause();
    const embed = new MessageEmbed()
        .setColor('RED')
        .setTitle('▶再生を再開しました')
        .setThumbnail(message.author.avatarURL({ dynamic: true }))
        .setFooter({ text: `実行者:${message.author.tag}` })
    await message.channel.send({ embeds: [embed] });
};

const loop_song = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    song_queue.loop = !song_queue.loop;
    await message.channel.send(`:repeat:ループを${song_queue.loop ? `有効` : `無効`}にしました！`);
};

const shuffle_queue = async(message, song_queue) => {
    if (await check_state_invalid(message)) return;
    song_queue.songs = random(song_queue.songs);
    await message.channel.send(`:twisted_rightwards_arrows:キューをシャッフルしました！`)
}

const loop_queue = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    song_queue.q_loop = !song_queue.q_loop;
    await message.channel.send(`:repeat:全曲ループを${song_queue.q_loop ? `有効` : `無効`}にしました！`);
};

const show_queue = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    const embed = new MessageEmbed()
        .setColor('RED')
        .setTitle(':notes: キュー')
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setFooter({ text: `実行者:${message.author.tag}` })
    let counter = 0;
    for (const song of song_queue.songs) {
        if (!counter) {
            embed.addField(`現在再生中:${song.title}`, `再生時間:${seconds_to_time(song.time)} | ${format_viewcount(song.views)}回再生されています！`)
            counter++;
        } else {
            embed.addField(`${counter}.${song.title}`, `再生時間:${seconds_to_time(song.time)} | ${format_viewcount(song.views)}回再生されています！`)
            counter++;
        }
    }
    message.channel.send({ embeds: [embed] });
};

const show_help = async (message) => {
    const embed = new MessageEmbed()
        .setColor('RED')
        .setTitle('📒 ヘルプを表示します')
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setFooter({ text: `実行者:${message.author.tag}` })
        .addFields(
            { name: `${config.prefix}help`, value: 'このヘルプを表示します。' },
            { name: `${config.prefix}play <URL or query>`, value: '指定したURL、もしくはキーワード検索の結果を再生します。' },
            { name: `${config.prefix}stop`, value: '再生中の楽曲を停止します。' },
            { name: `${config.prefix}pause`, value: '再生中の楽曲を一時停止します。' },
            { name: `${config.prefix}queue`, value: '再生中の楽曲キューを表示します。' },
            { name: `${config.prefix}resume`, value: '再生中の楽曲を再開します。' },
            { name: `${config.prefix}skip`, value: '再生中の楽曲をスキップします。' },
            { name: `${config.prefix}loop`, value: '再生中の楽曲をループするかどうかを切り替えます。' },
            { name: `${config.prefix}aloop`, value: '全曲ループを有効にするかどうかを切り替えます。' },
            { name: `${config.prefix}volume <0-100(upper)>`, value: '再生中の楽曲の音量を変更します。' },
            { name: `${config.prefix}shuffle`, value: 'キューをシャッフルします。'}
        )
    message.channel.send({ embeds: [embed] });
};

const change_volume = async (message, song_queue) => {
    if (await check_state_invalid(message)) return;
    song_queue.resource.volume.setVolume(message.content.split(' ')[1]);
    message.channel.send(`:loud_sound: 音量を**${message.content.split(' ')[1]}**に変更しました。`);
};

client.on('threadCreate', async thread => {
    try {
        if (thread.joinable && !thread.joined) await thread.join();
    } catch (e) {
        console.error(`[ERROR]${e}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
