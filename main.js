'use strict';

const http = require('http');
http
    .createServer(function (req, res) {
        res.write('online');
        res.end();
    })
    .listen(8080);
const Discord = require('discord.js');
const client = new Discord.Client();
const config = require('./config.json');

const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const queue = new Map();
client.on('ready', () => {
    console.log('Music Client started!');
});

client.on('message', async message => {
    //if (!message.member.voice.channel) console.error("ボイスチャンネルに参加していません。");
    const server_queue = queue.get(message.guild.id);
    const args = message.content
        .slice(config.prefix.length)
        .trim()
        .split(/ +/g);

    if (message.content.startsWith(`${config.prefix}play`)) {
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
                //author: song_info.author
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
                    //author: song_info.author
                };
            } else {
                message.channel.send('該当する動画が見つかりませんでした。');
            }
        }

        if (!server_queue) {
            let queue_constructor = {
                voice_channel: message.member.voice.channel,
                text_channel: message.channel,
                connection: null,
                songs: [],
                loop: false,
                q_loop: false
            };


            queue.set(message.guild.id, queue_constructor);
            queue_constructor.songs.push(song);

            let embed = new Discord.MessageEmbed()
                .setColor('RED')
                .setTitle(':notes:再生中')
                .setImage(`${song.thumbnail.url}`)
                .addField(':tv:動画:', `${song.title}`)
                .addField(':link:URL:', `${song.url}`)
                //.addField(":clapper:チャンネル:", `${song.author}`)
                .setFooter(`👀再生回数: ${song.views}回`);
            message.channel.send(embed);
            try {
                const connection = await queue_constructor.voice_channel.join();
                queue_constructor.connection = connection;
                video_player(message.guild, queue_constructor.songs[0]);
            } catch (err) {
                queue.delete(message.guild.id);
                message.channel.send('接続エラーが発生しました。権限が適切でないか、技術的な問題が発生しました。');
                throw err;
            }
        } else {
            server_queue.songs.push(song);
            return message.channel.send(`:notes:**${song.title}** をキューに追加しました。`);
        }
    }
    if (message.content.startsWith(`${config.prefix}skip`))
        skip_song(message);
    if (message.content.startsWith(`${config.prefix}stop`))
        stop_song(message, server_queue);
    if (message.content.startsWith(`${config.prefix}loop`))
        loop_song(message);
    if (message.content.startsWith(`${config.prefix}aloop`))
        queue_loop(message);
});

const video_player = async (guild, song) => {
    const song_queue = queue.get(guild.id);
    if (!song) {
        song_queue.voice_channel.leave();
        queue.delete(guild.id);
        return;
    }
    const stream = ytdl(song.url, { 
      filter: 'audioonly',
      highWaterMark: 128
    });
    song_queue.connection
        .play(stream, { seek: 0, volume: 0.5 })
        .on('finish', () => {
            if (!song_queue.loop && !song_queue.q_loop){
            song_queue.songs.shift();
            video_player(guild, song_queue.songs[0]);
            } 
            if(song_queue.q_loop) {
              song_queue.songs.push(song_queue.songs.shift());
              video_player(guild, song_queue.songs[0])
            }
        });
};

const skip_song = (message) => {
    if (!message.member.voice.channel) return message.channel.send('ボイスチャンネルに参加していません');
    const song_queue = queue.get(message.guild.id);
    if (!song_queue) return message.channel.send('キューに曲がありません。');
    song_queue.connection.dispatcher.end();
};

const stop_song = (message, server_queue) => {
    if (!message.member.voice.channel) return message.channel.send('ボイスチャンネルに参加していません。');
    server_queue.songs = [];
    server_queue.connection.dispatcher.end();
    let embed = new Discord.MessageEmbed()
        .setColor('RED')
        .setTitle('⏹再生を終了しました')
        .setThumbnail(message.author.avatarURL({ dynamic: true }))
        .setFooter(
            `実行者:${message.author.username}#${message.author.discriminator}`
        );
    message.channel.send({ embed });
};

const loop_song = async (message) => {
    const song_queue = queue.get(message.guild.id);
    if (!message.member.voice.channel) return message.channel.send("音声チャンネルにいる必要があります！");
    if (!song_queue) return message.channel.send("音楽が再生されてません");
    song_queue.loop = !song_queue.loop;
    await message.channel.send(`:repeat:ループを${song_queue.loop ? `有効` : `無効`}にしました`);
}

const queue_loop = async (message) => {
    const song_queue = queue.get(message.guild.id);
    if (!message.member.voice.channel) return message.channel.send("音声チャンネルにいる必要があります！");
    if (!song_queue) return message.channel.send("音楽が再生されてません");
    song_queue.q_loop = !song_queue.q_loop;
    await message.channel.send(`:repeat:全曲ループを${song_queue.q_loop ? `有効` : `無効`}にしました`);
}

client.login(process.env.token);
