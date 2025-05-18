const Event = require("./event");
const { loadFromJson } = require("../utils");

class OnMineBlock extends Event {
    static name = "OnMineBlock";
    constructor(bot, args) {
        super(bot, OnMineBlock.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('mineBlock', this.handler);
    }

    async stop(){
        this.bot.removeListener('mineBlock', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);

        this.obs.push({
            eventName: "mineBlock",
            agentName: agentName,
            visible: {
                pos: event.pos,
                blockName: event.blockName,
            },
            hidden: null
        });
    }
}

module.exports = OnMineBlock;
