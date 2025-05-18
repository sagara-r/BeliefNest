import time
import re
import warnings
from typing import List

import psutil
import subprocess
from logging import getLogger, FileHandler, Formatter, INFO
import threading

import belief_nest.utils as U


class SubprocessMonitor(U.MethodLogging):
    def __init__(
        self,
        commands: List[str],
        name: str,
        ready_match: str,
        log_path: str = "logs",
        log_level = INFO,
        kill_children: bool = False
    ):
        self.commands = commands
        start_time = time.strftime("%Y%m%d_%H%M%S")
        self.name = name
        self.ready_match = ready_match
        self.logger = getLogger(name)
        handler = FileHandler(U.f_join(log_path, f"mineflayer_{start_time}.log"))
        formatter = Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)
        self.logger.setLevel(log_level)
        self.process = None
        self.thread = None

        self.kill_children = kill_children

    def _start(self):
        self.logger.info(f"Starting subprocess with commands: {self.commands}")

        self.process = psutil.Popen(
            self.commands,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
        )
        print(f"Subprocess {self.name} started with PID {self.process.pid}.")
        for line in iter(self.process.stdout.readline, ""):
            s = line.strip().split()
            if len(s) < 2 or s[1] not in ["[TRACE]", "[DEBUG]", "[INFO]", "[WARN]", "[ERROR]", "[FATAL]"]:
                self.logger.info(line.strip())
            else:
                if s[1] == "[TRACE]":
                    self.logger.debug("[TRACE] " + " ".join(s[2:]))
                if s[1] == "[DEBUG]":
                    self.logger.debug(" ".join(s[2:]))
                if s[1] == "[INFO]":
                    self.logger.info(" ".join(s[2:]))
                if s[1] == "[WARN]":
                    self.logger.warning(" ".join(s[2:]))
                if s[1] == "[ERROR]":
                    self.logger.error(" ".join(s[2:]))
                if s[1] == "[FATAL]":
                    self.logger.critical(" ".join(s[2:]))
            
            if re.search(self.ready_match, line):
                self.ready_line = line
                self.logger.info("Subprocess is ready.")
                self.ready_event.set()
        if not self.ready_event.is_set():
            self.ready_event.set()
            warnings.warn(f"Subprocess {self.name} failed to start.")

    def run(self):
        self.ready_event = threading.Event()
        self.ready_line = None
        self.thread = threading.Thread(target=self._start)
        self.thread.start()
        self.ready_event.wait()

    def stop(self):
        self.logger.info("Stopping subprocess.")
        if self.process and self.process.is_running():
            if self.kill_children:
                self.stop_children()
            
            if self.process.is_running():
                self.process.terminate()
                self.process.wait()

    def stop_proc_using_port(self, a_port):
        def find_process_id_by_port(port):
            for conn in psutil.net_connections():
                if conn.laddr.port == port:
                    return conn.pid
        
        def kill_process_by_pid(pid):
            if pid is None:
                print(f"Process using pid {pid} was not found.")
                return
            try:
                p = psutil.Process(pid)
                p.terminate() 
                p.wait() 
                print(f"Killed the process PID {pid}.")
            except psutil.NoSuchProcess:
                print("Cannot kill the process because it no longer exists.")

        pid = find_process_id_by_port(a_port)
        if pid:
            kill_process_by_pid(pid)

    def stop_children(self, recursive=True):
        try:
            parent = psutil.Process(self.process.pid)
        except psutil.NoSuchProcess:
            return
        children = parent.children(recursive=recursive)
        for child in children:
            if child.is_running:
                child.terminate()
                child.wait()
        psutil.wait_procs(children, timeout=5)

    @property
    def is_running(self):
        if self.process is None:
            return False
        return self.process.is_running()
