async function backFlipEmoteExtention(bot) {
    await emote("\"Back Flip\"", "back flip")
}

async function facePalmEmoteExtention(bot) {
    await emote("\"Face palm\"", "face palm")
}

async function cossackDanceEmoteExtention(bot) {
    await emote("\"kazotsky kick\"", "cossack dance")
    const sec = 3;
    emoteStopAfter(sec)
}

async function jumpAndWaveForwardEmoteExtention(bot) {
    await emote("\"Over here\"", "jump and wave forward")
}

async function robloxPotionDanceEmoteExtention(bot) {
    await emote("\"roblox potion dance\"", "roblox potion dance")
    const sec = 3;
    emoteStopAfter(sec)
}

async function cryEmoteExtention(bot) {
    await emote("Crying", "cry")
}

async function pointFingerForwardEmoteExtention(bot) {
    await emote("Point", "point finger forward")
}

async function waveForwardEmoteExtention(bot) {
    await emote("Wave", "wave forward")
}

async function emote(emoteName, type){
    bot.chat(`/emotes play ${emoteName}`)
    await bot.waitForTicks(40)

    const msgObj = {
        "name": "emote",
        "type": type
    };
    bot.emit("event", dumpToJson(msgObj));  
}

function emoteStopAfter(sec){
    setTimeout(() => {
        bot.chat(`/emotes stop`)
    }, sec * 1000); 
}