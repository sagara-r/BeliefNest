%echo off
docker network create bnnet
docker compose up -d
docker attach mc_server
pause