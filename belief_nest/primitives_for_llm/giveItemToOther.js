// give 2 diamonds to other player `mike`, giveItemToOther(bot, "mike", "diamond", 2)
// Note that the bot must be CLOSE ENOUGH to the other player.
// Get close to the other player before calling `giveItemToOther`.
// othername must not be the bot itself.
async function giveItemToOther(bot, othername, item, num) {
    bot.chat(`/clear ${bot.entity.username} ${item} ${num}`)
    bot.chat(`/give ${othername} ${item} ${num}`)
    const success = true;
    return success
}
