const Event = require("./event");
const { loadFromJson } = require("../utils");

class OnThink extends Event {
    static name = "OnThink";
    constructor(bot, args) {
        super(bot, OnThink.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('think', this.handler);
    }

    async stop(){
        this.bot.removeListener('think', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);
        const msg = event.msg;
        
        this.obs.push({
            eventName: "think",
            agentName: agentName,
            visible: null,
            hidden: {"msg":msg},
        });
    }
}

module.exports = OnThink;
