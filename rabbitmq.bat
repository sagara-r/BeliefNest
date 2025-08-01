%echo off

docker info >nul 2>&1
IF ERRORLEVEL 1 (
    echo Error: Docker Desktop is not running. Please start it and try again.
    pause
    exit /b 1
)

docker network inspect bnnet >nul 2>&1 || docker network create bnnet
docker run -it --rm --network bnnet --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4.1-management
pause