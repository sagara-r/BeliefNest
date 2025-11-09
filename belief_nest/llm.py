import re
import time
import json
from datetime import datetime
from pathlib import Path
from javascript import require
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, SystemMessage, HumanMessage
from jinja2 import Environment, StrictUndefined

from belief_nest.primitives_for_llm import load_primitives_for_llm
from belief_nest.utils import fix_and_parse_json


def coding_llm(system_message_template_str:str, human_message_str:str, api_key:str, log_dir:str, logger, model_name="gpt-4o", max_trial=3, disallowed_expressions=[]):
    model = ChatOpenAI(
        model_name=model_name,
        temperature=0,
        request_timeout=120,
        api_key=api_key,
    )

    primitives = load_primitives_for_llm()
    system_message = SystemMessage(
        content=system_message_template_str.replace("$$PRIMITIVES$$", "\n".join(primitives))
    )

    last_code = "No code was executed"
    last_error = "No error"
    for _ in range(max_trial):
        human_message = HumanMessage(
            content=human_message_str.replace("$$LAST_CODE$$", last_code).replace("$$LAST_ERROR$$", last_error)
        )

        print(f"\033[32m\n###### Coding LLM ###### \033[0m")
        print(f"\033[32m{system_message.content}\033[0m")
        print(f"\033[32m{human_message.content}\033[0m")

        message = model.invoke([system_message, human_message])
        parsed_result, error = _process_ai_message(message, disallowed_expressions=disallowed_expressions)

        timestr = datetime.now().strftime('%Y%m%d_%H%M%S')

        with (Path(log_dir) / f"coding_llm_{timestr}_sys_prompt.txt").open("w") as f:
            f.write(system_message.content)

        with (Path(log_dir) / f"coding_llm_{timestr}_human_prompt.txt").open("w") as f:
            f.write(human_message.content)
        
        if error is None:
            code = parsed_result["whole_code"]
            with (Path(log_dir) / f"coding_llm_{timestr}_code.txt").open("w") as f:
                f.write(code)
            print(f"\033[31m{code}\033[0m")
            return code, timestr
        
        with (Path(log_dir) / f"coding_llm_{timestr}_failed_code.txt").open("w") as f:
            f.write(parsed_result["failed_code"])
        
        last_code = parsed_result["failed_code"]
        last_error = error

        logger.info(f"Failed coding. Message: {error}")
    
    print(f"Failed coding in {max_trial} trials.")
    return "await doNothing(bot);", None


def _process_ai_message(message, disallowed_expressions=[]):
    assert isinstance(message, AIMessage)

    retry = 3
    error = None
    code = None
    while retry > 0:
        try:
            babel = require("@babel/core")
            babel_generator = require("@babel/generator").default

            code_pattern = re.compile(r"```(?:javascript|js)(.*?)```", re.DOTALL)
            code = "\n".join(code_pattern.findall(message.content))

            # check whether disallowed expressions are included
            for dic in disallowed_expressions:
                assert dic["expression"] not in code, dic["message"]

            #for line in code.split("\n"):
            #    if "/tell" in line and "/tell @s" not in line:
            #        raise Exception('Do not whisper to others using `bot.chat("/tell otherPlayerName ...")`. You can only whisper to yourself.')

            parsed = babel.parse(code)
            functions = []
            assert len(list(parsed.program.body)) > 0, "No functions found"
            for i, node in enumerate(parsed.program.body):
                if node.type != "FunctionDeclaration":
                    continue
                node_type = (
                    "AsyncFunctionDeclaration"
                    if node["async"]
                    else "FunctionDeclaration"
                )
                functions.append(
                    {
                        "name": node.id.name,
                        "type": node_type,
                        "body": babel_generator(node).code,
                        "params": list(node["params"]),
                    }
                )
            # find the last async function
            main_function = None
            for function in reversed(functions):
                if function["type"] == "AsyncFunctionDeclaration":
                    assert main_function is None, "Do not define multiple async functions. Only the main function can be defined as an async function. Also, just use the provided useful programs instead of redefining them."
                    main_function = function
            assert (
                main_function is not None
            ), "No async function found. Your main function must be async."
            assert (
                len(main_function["params"]) == 1
                and main_function["params"][0].name == "bot"
            ), f"Main function {main_function['name']} must take a single argument named 'bot'"
            program_code = "\n\n".join(function["body"] for function in functions)
            exec_code = f"await {main_function['name']}(bot);"
            return {
                "program_code": program_code,
                "program_name": main_function["name"],
                "exec_code": exec_code,
                "whole_code": program_code + "\n" + exec_code
            }, None
        except Exception as e:
            retry -= 1
            error = e
            time.sleep(1)

    return {"failed_code": code}, f"Error parsing action response (before program execution): {error}"


def llm(messages, api_key, model_name="gpt-4o", log_dir=None, name=None, json_mode=False):
    model_kwargs = {}
    if json_mode:
        model_kwargs["response_format"] = {"type": "json_object"}

    model = ChatOpenAI(
        model_name=model_name,
        temperature=0,
        request_timeout=120,
        api_key=api_key,
        model_kwargs=model_kwargs,
    )

    response = model.invoke(messages).content

    if json_mode:
        response = json.loads(response)

    if log_dir:
        timestr = datetime.now().strftime('%Y%m%d_%H%M%S')
        with (Path(log_dir) / f"{name}_{timestr}_response.txt").open("w") as f:
            f.write(response)

    return response

def planning_llm(system_message_template_str:str, human_message_template_str:str, api_key:str, log_dir:str, logger, model_name="gpt-4o", max_trial=3):
    model = ChatOpenAI(
        model_name=model_name,
        temperature=0,
        request_timeout=120,
        api_key=api_key,
    )

    system_message = SystemMessage(
        content=system_message_template_str
    )

    for _ in range(max_trial):
        human_message = HumanMessage(
            content=human_message_template_str
        )

        print(f"\033[32m\n###### planning LLM ###### \033[0m")
        print(f"\033[32m{system_message.content}\033[0m")
        print(f"\033[32m{human_message.content}\033[0m")

        message = model.invoke([system_message, human_message])

        timestr = datetime.now().strftime('%Y%m%d_%H%M%S')

        with (Path(log_dir) / f"planning_llm_{timestr}_sys_prompt.txt").open("w") as f:
            f.write(system_message.content)

        with (Path(log_dir) / f"planning_llm_{timestr}_human_prompt.txt").open("w") as f:
            f.write(human_message.content)
        
        response = message.content
        with (Path(log_dir) / f"planning_llm_{timestr}.txt").open("w") as f:
            f.write(response)
        print(f"\033[31m{response}\033[0m")
        plan = fix_and_parse_json(response)
        return plan, timestr
    
        # with (Path(log_dir) / f"planning_llm_{timestr}_failed_code.txt").open("w") as f:
        #     f.write(parsed_result["failed_code"])
        
        # last_code = parsed_result["failed_code"]
        # last_error = error

        # logger.info(f"Failed coding. Message: {error}")
    
    raise Exception(f"Failed coding in {max_trial} trials.")

def check_llm(system_message_template_str:str, human_message_template_str:str, api_key:str, log_dir:str, logger, model_name="gpt-4o", max_trial=3):
    model = ChatOpenAI(
        model_name=model_name,
        temperature=0,
        request_timeout=120,
        api_key=api_key,
    )

    system_message = SystemMessage(
        content=system_message_template_str
    )

    for _ in range(max_trial):
        human_message = HumanMessage(
            content=human_message_template_str
        )

        print(f"\033[32m\n###### check LLM ###### \033[0m")
        print(f"\033[32m{system_message.content}\033[0m")
        print(f"\033[32m{human_message.content}\033[0m")

        message = model.invoke([system_message, human_message])

        timestr = datetime.now().strftime('%Y%m%d_%H%M%S')

        with (Path(log_dir) / f"check_llm_{timestr}_sys_prompt.txt").open("w") as f:
            f.write(system_message.content)

        with (Path(log_dir) / f"check_llm_{timestr}_human_prompt.txt").open("w") as f:
            f.write(human_message.content)
        
        response = message.content
        with (Path(log_dir) / f"check_llm_{timestr}.txt").open("w") as f:
            f.write(response)
        print(f"\033[31m{response}\033[0m")
        check_result = fix_and_parse_json(response)
        return check_result, timestr
    
        # with (Path(log_dir) / f"check_llm_{timestr}_failed_code.txt").open("w") as f:
        #     f.write(parsed_result["failed_code"])
        
        # last_code = parsed_result["failed_code"]
        # last_error = error

        # logger.info(f"Failed coding. Message: {error}")
    
    raise Exception(f"Failed coding in {max_trial} trials.")

def reflect_llm(system_message_template_str:str, human_message_template_str:str, api_key:str, log_dir:str, logger, model_name="gpt-4o", max_trial=3):
    model = ChatOpenAI(
        model_name=model_name,
        temperature=0,
        request_timeout=120,
        api_key=api_key,
    )

    system_message = SystemMessage(
        content=system_message_template_str
    )

    for _ in range(max_trial):
        human_message = HumanMessage(
            content=human_message_template_str
        )

        print(f"\033[32m\n###### reflect LLM ###### \033[0m")
        print(f"\033[32m{system_message.content}\033[0m")
        print(f"\033[32m{human_message.content}\033[0m")

        message = model.invoke([system_message, human_message])

        timestr = datetime.now().strftime('%Y%m%d_%H%M%S')

        with (Path(log_dir) / f"reflect_llm_{timestr}_sys_prompt.txt").open("w") as f:
            f.write(system_message.content)

        with (Path(log_dir) / f"reflect_llm_{timestr}_human_prompt.txt").open("w") as f:
            f.write(human_message.content)
        
        response = message.content
        with (Path(log_dir) / f"reflect_llm_{timestr}.txt").open("w") as f:
            f.write(response)
        print(f"\033[31m{response}\033[0m")
        reflect_result = fix_and_parse_json(response)
        return reflect_result, timestr
    
        # with (Path(log_dir) / f"reflect_llm_{timestr}_failed_code.txt").open("w") as f:
        #     f.write(parsed_result["failed_code"])
        
        # last_code = parsed_result["failed_code"]
        # last_error = error

        # logger.info(f"Failed coding. Message: {error}")
    
    raise Exception(f"Failed coding in {max_trial} trials.")

def replanning_llm(system_message_template_str:str, human_message_template_str:str, api_key:str, log_dir:str, logger, model_name="gpt-4o", max_trial=3):
    model = ChatOpenAI(
        model_name=model_name,
        temperature=0,
        request_timeout=120,
        api_key=api_key,
    )

    system_message = SystemMessage(
        content=system_message_template_str
    )

    for _ in range(max_trial):
        human_message = HumanMessage(
            content=human_message_template_str
        )

        print(f"\033[32m\n###### replanning LLM ###### \033[0m")
        print(f"\033[32m{system_message.content}\033[0m")
        print(f"\033[32m{human_message.content}\033[0m")

        message = model.invoke([system_message, human_message])

        timestr = datetime.now().strftime('%Y%m%d_%H%M%S')

        with (Path(log_dir) / f"replanning_llm_{timestr}_sys_prompt.txt").open("w") as f:
            f.write(system_message.content)

        with (Path(log_dir) / f"replanning_llm_{timestr}_human_prompt.txt").open("w") as f:
            f.write(human_message.content)
        
        response = message.content
        with (Path(log_dir) / f"replanning_llm_{timestr}.txt").open("w") as f:
            f.write(response)
        print(f"\033[31m{response}\033[0m")
        plan = fix_and_parse_json(response)
        return plan, timestr
    
        # with (Path(log_dir) / f"replanning_llm_{timestr}_failed_code.txt").open("w") as f:
        #     f.write(parsed_result["failed_code"])
        
        # last_code = parsed_result["failed_code"]
        # last_error = error

        # logger.info(f"Failed coding. Message: {error}")
    
    raise Exception(f"Failed coding in {max_trial} trials.")

def intention_llm(system_message_template_str:str, human_message_template_str:str, api_key:str, log_dir:str, logger, model_name="gpt-4o", max_trial=3):

    model = ChatOpenAI(
        model_name=model_name,
        temperature=0,
        request_timeout=120,
        api_key=api_key,
    )

    env = Environment(
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True
    )

    system_message_template = env.from_string(system_message_template_str)
    system_message = SystemMessage(
        content=system_message_template.render({})
    )

    human_message_template = env.from_string(human_message_template_str)

    for _ in range(max_trial):
        human_message = HumanMessage(
            content=human_message_template.render({})
        )

        print(f"\033[32m\n###### intention LLM ###### \033[0m")
        print(f"\033[32m{system_message.content}\033[0m")
        print(f"\033[32m{human_message.content}\033[0m")

        message = model.invoke([system_message, human_message])

        timestr = datetime.now().strftime('%Y%m%d_%H%M%S')

        with (Path(log_dir) / f"intention_llm_{timestr}_sys_prompt.txt").open("w") as f:
            f.write(system_message.content)

        with (Path(log_dir) / f"intention_llm_{timestr}_human_prompt.txt").open("w") as f:
            f.write(human_message.content)
        
        intention_result = message.content
        with (Path(log_dir) / f"intention_llm_{timestr}.txt").open("w") as f:
            f.write(intention_result)
        print(f"\033[31m{intention_result}\033[0m")
        return intention_result, timestr
    
        # with (Path(log_dir) / f"intention_llm_{timestr}_failed_code.txt").open("w") as f:
        #     f.write(parsed_result["failed_code"])
        
        # last_code = parsed_result["failed_code"]
        # last_error = error

        # logger.info(f"Failed coding. Message: {error}")
    
    raise Exception(f"Failed coding in {max_trial} trials.")