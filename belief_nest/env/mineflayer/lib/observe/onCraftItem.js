const Event = require("./event");
const { loadFromJson } = require("../utils");

class OnCraftItem extends Event {
    static name = "OnCraftItem";
    constructor(bot, args) {
        super(bot, OnCraftItem.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('craftItem', this.handler);
    }

    async stop(){
        this.bot.removeListener('craftItem', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);

        this.obs.push({
            eventName: "craftItem",
            agentName: agentName,
            visible: {
                itemName: event.itemName,
                count: event.count,
                consumedItems: event.consumedItems,
            },
            hidden: null
        });
    }
}

module.exports = OnCraftItem;
