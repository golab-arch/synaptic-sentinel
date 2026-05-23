# Synaptic Sentinel — DELIBERATELY VULNERABLE fixture for the Python taint-mode
# rules (FI-003 etapa 2, DG-063). Each function demonstrates an intentional
# taint flow source -> sink. Do NOT use in production.
#
# 1. run_user_command : sys.argv          -> subprocess.run
#    (CWE-78, sentinel-py-taint-command-injection)
# 2. delete_temp_file : request.form      -> os.system
#    (CWE-78, sentinel-py-taint-command-injection)
# 3. lookup_user      : request.args      -> cursor.execute (string concat)
#    (CWE-89, sentinel-py-taint-sql-injection)
# 4. read_user_file   : request.args      -> open
#    (CWE-22, sentinel-py-taint-path-traversal)

import os
import subprocess
import sys

from flask import request


def run_user_command():
    # CWE-78: sys.argv -> subprocess.run with shell=True + concatenation
    cmd_target = sys.argv[1]
    subprocess.run("ls " + cmd_target, shell=True)


def delete_temp_file():
    # CWE-78: request.form -> os.system
    name = request.form.get("name")
    os.system("rm /tmp/" + name)


def lookup_user(cursor):
    # CWE-89: request.args -> cursor.execute with string concatenation
    user_id = request.args.get("id")
    cursor.execute("SELECT * FROM users WHERE id = " + user_id)


def read_user_file():
    # CWE-22: request.args -> open (no sanitization)
    filename = request.args.get("name")
    with open(filename) as f:
        return f.read()
