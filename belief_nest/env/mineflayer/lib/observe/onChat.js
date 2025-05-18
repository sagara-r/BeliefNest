const Event = require("./event");

class OnChat extends Event {
    static name = "OnChat";
    constructor(bot, args) {
        super(bot, OnChat.name, "player");
        this.observeBound = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
        this.visibilityBasedHearing = args.visibilityBasedHearing ?? false;
    }

    async start(){
        this.bot.on('chat', this.observeBound);
    }

    async stop(){
        this.bot.removeListener('chat', this.observeBound);
    }

    async onUpdate(mcName, msg) {
        if(msg.startsWith("/")){
            return;
        }

        let agentName = null;
        for(const tAgentName in this.bot.agentInfo){
            if(mcName === this.bot.agentInfo[tAgentName].mcName){
                agentName = tAgentName;
                break;
            }
        }
        if(!agentName){
            return;
        }

        const obs = {
            eventName: "chat",
            visible: {"agentName": agentName, "msg":msg},
            hidden: null
        };
        if(this.visibilityBasedHearing){
            obs.agentName = agentName;
        }

        this.obs.push(obs);
    }
}

module.exports = OnChat;
