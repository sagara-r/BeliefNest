%echo off

:: Check if Docker is running
docker info >nul 2>&1
IF ERRORLEVEL 1 (
    echo Error: Docker Desktop is not running. Please start it and try again.
    pause
    exit /b 1
)

:: Check if an existing container named 'mc_server' is present
docker ps -a | findstr mc_server >nul
IF NOT ERRORLEVEL 1 (
    echo Existing container 'mc_server' found.
    
    :: Use choice to allow only y/n input
    choice /C YN /N /M "Do you want to remove this container? (y/n): "
    
    :: Check the choice and proceed accordingly
    IF ERRORLEVEL 2 (
        echo You chose not to remove the container. Aborting the operation.
        pause
        exit /b 1
    )
    
    IF ERRORLEVEL 1 (
        echo Removing the existing container...
        docker rm -f mc_server
    )
)

docker network inspect bnnet >nul 2>&1 || docker network create bnnet
docker compose up -d
docker attach mc_server
pause