import sys
import requests
import json

HOST = 'localhost'
PORT = 3000

args = sys.argv[1:]

commands = []
if len(args) == 1:
    filepath = args[0]
    with open(filepath) as f:
        commands = [l.strip() for l in f.readlines()]


def post_command(command, argsJsonStr):
    try:
        if argsJsonStr == "":
            argsJsonStr = "{}"
        args = json.loads(argsJsonStr)
    except Exception as e:
        print("Invalid json string.")
        return None, True
    
    url = f"http://{HOST}:{PORT}/{command}"
    print("url:",url)
    response = requests.post(url, json=args)
    return response, False

for sentence in commands:
    if len(sentence) == 0 or sentence[0] == "#":
        continue

    command = sentence.split(" ")[0]
    argsJsonStr = " ".join(sentence.split(" ")[1:])
    
    response, json_error = post_command(command, argsJsonStr)
    if json_error:
        exit()

    print(f"Status code [{response.status_code}]")
    if response.status_code == 200:
        try:
            print(f'Message: {response.json()}')
        except:
            pass
    else:
        print(f'Message: {response.json().get("errorMsg", "none")}')
        exit()

while True:
    tmp = input("> ").strip()
    if len(tmp) == 0:
        continue
    command = tmp.split(" ")[0]
    argsJsonStr = " ".join(tmp.split(" ")[1:])

    response, json_error = post_command(command, argsJsonStr)
    if json_error:
        continue
    print(f"Status code [{response.status_code}]")
    if response.status_code != 200:
        print(f'Message: {response.json().get("errorMsg", "none")}')
