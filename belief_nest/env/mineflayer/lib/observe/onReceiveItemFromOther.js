const Event = require("./event");
const { loadFromJson } = require("../utils");

class OnReceiveItemFromOther extends Event {
    static name = "OnReceiveItemFromOther";
    constructor(bot, args) {
        super(bot, OnReceiveItemFromOther.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('receiveItemFromOther', this.handler);
    }

    async stop(){
        this.bot.removeListener('receiveItemFromOther', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);

        const obs = {
            eventName: "receiveItemFromOther",
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

module.exports = OnReceiveItemFromOther;
