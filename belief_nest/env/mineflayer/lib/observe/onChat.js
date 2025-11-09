const Event = require("./event");

class OnChat extends Event {
    static name = "OnChat";
    constructor(bot, args) {
        super(bot, OnChat.name, "player");
        this.chatHandler = this.onChatEvent.bind(this);
        this.proxyChatHandler = this.onProxyChatEvent.bind(this);

        if(!args){
            args = {}
        }
        this.visibilityBasedHearing = args.visibilityBasedHearing ?? false;
    }

    async start(){
        this.bot.on('chat', this.chatHandler);
        this.bot.on('proxyChat', this.proxyChatHandler);
    }

    async stop(){
        this.bot.removeListener('chat', this.chatHandler);
        this.bot.removeListener('proxyChat', this.proxyChatHandler);
    }

    async record(agentName, msg){
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

    async onChatEvent(mcName, msg) {
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

        await this.record(agentName, msg);
    }

    // admin emits directly
    async onProxyChatEvent(agentName, msg){
        console.log("onProxyChatEvent");
        await this.record(agentName, msg);
    }
}

module.exports = OnChat;
