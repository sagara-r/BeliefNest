const Event = require("./event");
const { loadFromJson } = require("../utils");

class OnUseLever extends Event {
    static name = "OnUseLever";
    constructor(bot, args) {
        super(bot, OnUseLever.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('useLever', this.handler);
    }

    async stop(){
        this.bot.removeListener('useLever', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);

        const obs = {
            eventName: "useLever",
            agentName: agentName,
            visible: {
                leverPos: event.leverPos,
                type: event.type,
            },
            hidden: {}
        };

        this.obs.push(obs);
    }
}

module.exports = OnUseLever;
