async function think(bot, msg){
    if (typeof msg !== "string") {
        throw new Error("msg for think must be a string");
    }
    if(msg.length === 0){
        throw new Error("msg for think cannot be empty");
    }
    
    bot.chat(`/tell @s ${msg}`);
    const msgObj = {
        name: "think",
        msg: msg
    }
    bot.emit("event", dumpToJson(msgObj));
    await bot.waitForTicks(1);
}