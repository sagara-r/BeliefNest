const Event = require("./event");
const { loadFromJson } = require("../utils");

class OnSmeltItem extends Event {
    static name = "OnSmeltItem";
    constructor(bot, args) {
        super(bot, OnSmeltItem.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('smeltItem', this.handler);
    }

    async stop(){
        this.bot.removeListener('smeltItem', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);

        this.obs.push({
            eventName: "smeltItem",
            agentName: agentName,
            visible: {
                materialName: event.materialName,
                producedCount: event.producedCount,
                producedItemName: event.producedItemName,
                consumedItems: event.consumedItems,
                furnacePos: event.furnacePos,
            },
            hidden: null
        });
    }
}

module.exports = OnSmeltItem;
