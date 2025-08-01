// receive 2 diamonds from other player `mike`, receiveItemFromOther(bot, "mike", "diamond", 2)
// Note that the bot must be CLOSE ENOUGH to the other player.
// Get close to the other player before calling `receiveItemFromOther`.
// othername must not be the bot itself.
async function receiveItemFromOther(bot, othername, item, num) {
    bot.chat(`/give ${bot.entity.username} ${item} ${num}`)
    bot.chat(`/clear ${othername} ${item} ${num}`)
    const success = true;
    return success
}
