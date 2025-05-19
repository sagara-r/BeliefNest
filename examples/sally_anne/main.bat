%echo off
docker run -it --rm -v %cd%:/app -w /app --network bnnet --name beliefnest sagarar/beliefnest:latest python main.py
pause