import json
import requests
import functools
import types
from logging import getLogger, FileHandler, Formatter, INFO, Logger
from logging.handlers import HTTPHandler

class SessionHTTPHandler(HTTPHandler):
    def __init__(self, host, url, session=None, method="POST"):
        super().__init__(host, url, method)
        # initialize session
        self.session = session or requests.Session()

    def emit(self, record):
        try:
            log_entry = self.format(record)
            url = f'http://{self.host}{self.url}'
            self.session.post(url, data=log_entry, headers={"Content-type": "application/json"})
        except Exception:
            self.handleError(record)


class JsonFormatter(Formatter):
    def format(self, record):
        log_record = {
            "loggerName": record.name,
            "level": record.levelname,
            "message": record.getMessage(),
            "time": self.formatTime(record, self.datefmt)
        }
        return json.dumps(log_record)
    

class MethodLogging:
    def __getattribute__(self, name):
        attr = super().__getattribute__(name)
        
        if not isinstance(attr, types.MethodType) or name == "__init__":
            return attr
            
        @functools.wraps(attr)
        def wrapper(*args, **kwargs):
            class_name = self.__class__.__name__
            if not hasattr(self, 'logger'):
                raise AttributeError(f"{class_name} requires 'self.logger' to be defined before any method calls. Please define 'self.logger' in the constructor.")
            self.logger.debug(f"Calling method: {class_name}.{name}")
            result = attr(*args, **kwargs)
            self.logger.debug(f"Finished method: {class_name}.{name}")
            return result
        
        return wrapper


def create_logger(name, log_file=None, handler=None, formatter=None, level=INFO):
    assert log_file or handler
    logger = getLogger(name)
    handler = handler or FileHandler(filename=log_file, encoding="utf-8")
    formatter = formatter or Formatter('%(asctime)s ; %(name)s ; %(levelname)s ; %(message)s')
    handler.setFormatter(formatter)
    handler.setLevel(level)
    logger.setLevel(level)
    logger.addHandler(handler)
    logger.propagate = False

    return logger


def remove_all_handlers(logger):
    for _, logger in Logger.manager.loggerDict.items():
        if isinstance(logger, Logger):
            for h in logger.handlers:
                logger.removeHandler(h)
