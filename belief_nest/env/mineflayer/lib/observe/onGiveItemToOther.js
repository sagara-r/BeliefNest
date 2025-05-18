const Event = require("./event");
const { loadFromJson } = require("../utils");

class OnGiveItemToOther extends Event {
    static name = "OnGiveItemToOther";
    constructor(bot, args) {
        super(bot, OnGiveItemToOther.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('giveItemToOther', this.handler);
    }

    async stop(){
        this.bot.removeListener('giveItemToOther', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);

        const obs = {
            eventName: "giveItemToOther",
            agentName: agentName,
            visible: {
                otherAgentName: event.otherAgentName,
                itemName: event.itemName,
                count: event.count,
            },
            hidden: null
        };

        this.obs.push(obs);
    }
}

module.exports = OnGiveItemToOther;
