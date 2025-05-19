FROM python:3.13-slim

# Node.js install 
RUN apt-get update && apt-get install -y curl gnupg xz-utils \
    && curl -fsSL https://nodejs.org/dist/v22.15.1/node-v22.15.1-linux-x64.tar.xz -o node.tar.xz \
    && mkdir -p /usr/local/lib/nodejs \
    && tar -xJf node.tar.xz -C /usr/local/lib/nodejs \
    && rm node.tar.xz \
    && ln -s /usr/local/lib/nodejs/node-v22.15.1-linux-x64/bin/node /usr/bin/node \
    && ln -s /usr/local/lib/nodejs/node-v22.15.1-linux-x64/bin/npm /usr/bin/npm \
    && ln -s /usr/local/lib/nodejs/node-v22.15.1-linux-x64/bin/npx /usr/bin/npx

WORKDIR /BeliefNest
COPY . /BeliefNest
RUN pip install -e .

WORKDIR /BeliefNest/belief_nest/env/mineflayer/
RUN npm install

WORKDIR /BeliefNest