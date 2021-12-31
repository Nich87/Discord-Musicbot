const pad = num => ('' + num).padStart(2, '0');
function seconds_to_time(seconds) {
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;
    return (hours ? `${hours}:${pad(minutes)}` : minutes) + `:${pad(seconds)}`;
}

function format_viewcount(count) {
    const views = new Intl.NumberFormat('ja-JP', {
        notation: 'compact'
    }).format(BigInt(count));
    return views;
}

module.exports = { seconds_to_time, format_viewcount };
