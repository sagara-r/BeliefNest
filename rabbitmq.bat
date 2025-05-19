%echo off
docker network create bnnet
docker run -it --rm --network bnnet --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4.1-management
pause